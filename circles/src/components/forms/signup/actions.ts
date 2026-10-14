"use server";

import crypto from "crypto";
import { FormSubmitResponse, UserPrivate } from "../../../models/models";
import { AuthenticationError, createUserSession, createUserAccount } from "@/lib/auth/auth";
import { updateCircle, createCircle, getCircleByHandle } from "@/lib/data/circle";
import { addMember } from "@/lib/data/member";
import { getUserPrivate } from "@/lib/data/user";
import { ensureWelcomeMessageForNewUser } from "@/lib/data/mongo-chat";
import { getResolvedWelcomeTemplate } from "@/lib/data/system-message-templates";
import { checkAltchaPayload } from "@/lib/auth/altcha";
import { SIGNUP_HONEYPOT_FIELD } from "./signup-honeypot-field";
import { generateSlug } from "@/lib/utils";
import { generateLocalDidAndPublicKey } from "@/lib/auth/local-identity";
import { getDefaultModules } from "@/lib/data/constants";
import { PEERIFY_DEFAULT_ARTIST_AVATAR_URL, normalizePeerifyArtistProfile } from "@/lib/peerify/artist-profile";

// Derives a unique, valid circle handle from a free-text artist/band name, matching
// the same handle rules the CircleWizard's managed-identity creation enforces
// (lowercase, a-z0-9-, 3-20 chars) — falls back to "artist"/a random suffix if the
// name sanitizes down to nothing usable.
const generateUniqueArtistHandle = async (baseName: string): Promise<string> => {
    let base = generateSlug(baseName)
        .replace(/_/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 20)
        .replace(/-+$/g, "");
    if (base.length < 3 || !/^[a-z0-9-]+$/.test(base)) {
        base = "artist";
    }

    let candidate = base;
    for (let suffix = 2; suffix <= 50; suffix++) {
        if (!(await getCircleByHandle(candidate))) {
            return candidate;
        }
        const suffixStr = `-${suffix}`;
        candidate = `${base.slice(0, Math.max(1, 20 - suffixStr.length))}${suffixStr}`;
    }
    // Exhausted the readable suffix range (extremely unlikely) — fall back to a random one.
    return `artist-${crypto.randomBytes(3).toString("hex")}`;
};

// Auto-provisions a public, top-level artist circle alongside the personal circle
// created above, when the pilot signup role was "Artist / Band". Independent of the
// personal circle (no parentCircleId — the artist profile is meant to be primary, the
// personal circle the auto-generated afterthought). Reuses the same createCircle() +
// addMember() path the CircleWizard "Create" button uses, rather than extending
// createUserAccount/createNewUser. Starts as publishStatus "draft"; see
// isPilotArtistCircleReadyToPublish in src/lib/data/circle.ts for the readiness bar
// (picture + About text + map location + Community Guidelines) that gates the manual
// "Publish circle" button once all of it is complete.
const createPilotArtistCircle = async (userDid: string, bandOrVenueName: string): Promise<void> => {
    const handle = await generateUniqueArtistHandle(bandOrVenueName);
    const { did } = generateLocalDidAndPublicKey();

    const artistCircle = await createCircle(
        {
            name: bandOrVenueName,
            handle,
            did,
            isPublic: true,
            description: "",
            content: "",
            mission: "",
            circleType: "circle",
            circleLevel: "top_level",
            createdBy: userDid,
            publishStatus: "draft",
            enabledModules: Array.from(
                new Set([...getDefaultModules("circle").filter((module) => module !== "discussions"), "music"]),
            ),
            picture: { url: PEERIFY_DEFAULT_ARTIST_AVATAR_URL },
            causes: [],
            skills: [],
            metadata: {
                peerify: {
                    managedIdentity: true,
                    identityType: "artist",
                    autoProvisionedFromSignup: true,
                    artistProfile: normalizePeerifyArtistProfile({}),
                },
            },
        },
        userDid,
    );

    await addMember(userDid, artistCircle._id!, ["admins", "moderators", "members"]);
};

// The ALTCHA challenge is fetched when the form is shown, so its signed issue time says how long
// the form has been open. Faster than this is a script.
const SIGNUP_MIN_FORM_AGE_SECONDS = 3;

// The only metadata a signup form may set. Everything else a client sends is dropped: the whole
// object used to be stored on the new user circle, so a client could set e.g.
// metadata.peerify.managedIdentity/identityType on itself, or store megabytes of junk.
const SIGNUP_ONBOARDING_FLOWS = ["pilot-quick-signup", "v2-signup"];
const SIGNUP_INTENTS = ["fan", "artist"];
const BAND_OR_VENUE_NAME_MAX_LENGTH = 80;

type SignupMetadata = { onboardingFlow?: string; signupIntent?: string; bandOrVenueName?: string };

const pickSignupMetadata = (value: unknown): SignupMetadata | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const picked: SignupMetadata = {};
    if (typeof input.onboardingFlow === "string" && SIGNUP_ONBOARDING_FLOWS.includes(input.onboardingFlow)) {
        picked.onboardingFlow = input.onboardingFlow;
    }
    if (typeof input.signupIntent === "string" && SIGNUP_INTENTS.includes(input.signupIntent)) {
        picked.signupIntent = input.signupIntent;
    }
    if (picked.signupIntent === "artist" && typeof input.bandOrVenueName === "string") {
        const name = input.bandOrVenueName.trim().slice(0, BAND_OR_VENUE_NAME_MAX_LENGTH).trim();
        if (name) picked.bandOrVenueName = name;
    }
    return Object.keys(picked).length > 0 ? picked : undefined;
};

// keepAltcha: the challenge was not spent (too fast), so the form keeps the solved widget and the
// same click works a moment later. On every other failure the challenge is spent and the form
// needs a fresh one.
export type SignupFormResponse = FormSubmitResponse & { keepAltcha?: boolean };

export const submitSignupFormAction = async (values: Record<string, any>): Promise<SignupFormResponse> => {
    try {
        const altcha = await checkAltchaPayload(values.altcha, { minFormAgeSeconds: SIGNUP_MIN_FORM_AGE_SECONDS });
        if (!altcha.ok) {
            console.warn(`[signup] refused: ALTCHA ${altcha.reason}`);
            if (altcha.reason === "too_fast") {
                return {
                    success: false,
                    keepAltcha: true,
                    message: "That was quick. Please check your details and press the button again.",
                };
            }
            return { success: false, message: "Please complete the human-verification check." };
        }
        // Checked after the ALTCHA is spent, so a bot can't keep reusing one challenge here. The
        // reply is deliberately plain.
        const honeypot = values[SIGNUP_HONEYPOT_FIELD];
        if (typeof honeypot === "string" ? honeypot.trim() !== "" : honeypot != null) {
            console.warn("[signup] refused: honeypot field filled");
            return { success: false, message: "Signup failed. Please try again." };
        }
        console.log(
            `[signup] ALTCHA ok: form open ${altcha.formAgeSeconds}s, solve ${altcha.solveMs ?? "-"}ms (client-reported)`,
        );

        const normalizedHandle = String(values.handle || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s_-]+/g, "")
            .replace(/[\s_]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "");
        const normalizedEmail = String(values._email || "").trim().toLowerCase();
        const derivedName =
            String(values.name || "").trim() ||
            normalizedHandle
                .split("-")
                .filter(Boolean)
                .join(" ") ||
            normalizedEmail.split("@")[0];

        const signupType = values.type === "organization" ? "organization" : "user";
        const requestedSkills = Array.isArray(values.skills)
            ? values.skills.filter((skill): skill is string => typeof skill === "string" && skill.trim().length > 0)
            : undefined;
        const requestedInterests = Array.isArray(values.interests)
            ? values.interests.filter(
                  (interest): interest is string => typeof interest === "string" && interest.trim().length > 0,
              )
            : undefined;
        const requestedMetadata = pickSignupMetadata(values.metadata);

        // The pilot signup form no longer collects a password (magic-link only), but
        // createUserAccount still needs one to derive the key encrypting the user's
        // private key on disk. Generate one server-side; it's never surfaced or emailed,
        // so it can't be used to log in — only the magic link can.
        const password =
            typeof values._password === "string" && values._password.length > 0
                ? values._password
                : crypto.randomBytes(32).toString("hex");

        let user = await createUserAccount(derivedName, normalizedHandle, signupType, normalizedEmail, password);
        await createUserSession(user as UserPrivate, user.did!);

        if (requestedSkills?.length || requestedInterests?.length || requestedMetadata) {
            await updateCircle(
                {
                    _id: user._id!,
                    skills: requestedSkills,
                    interests: requestedInterests,
                    offers: requestedSkills?.length
                        ? {
                              ...(user.offers ?? {}),
                              skills: requestedSkills,
                              visibility: user.offers?.visibility ?? "public",
                          }
                        : user.offers,
                    metadata: requestedMetadata ? { ...(user.metadata ?? {}), ...requestedMetadata } : user.metadata,
                },
                user.did!,
            );
        }

        if (requestedMetadata?.signupIntent === "artist") {
            const bandOrVenueName =
                typeof requestedMetadata.bandOrVenueName === "string" ? requestedMetadata.bandOrVenueName.trim() : "";
            if (bandOrVenueName) {
                try {
                    await createPilotArtistCircle(user.did!, bandOrVenueName);
                } catch (error) {
                    console.error("Failed to auto-provision artist circle for pilot signup:", error);
                }
            }
        }

        try {
            const resolvedWelcome = await getResolvedWelcomeTemplate();
            await ensureWelcomeMessageForNewUser(user.did!, resolvedWelcome.config, resolvedWelcome.senderDid);
        } catch (error) {
            console.error("Failed to create signup welcome message:", error);
        }

        // The Backstage Lounge follow + pin happens at first email verification, not here
        // (completeFirstEmailVerification in src/lib/data/first-email-verification.ts).

        // register user in the circles registry
        //let currentServerSettings = await getServerSettings();

        // if (currentServerSettings.registryUrl) {
        //     // register user
        //     try {
        //         // get public key for user
        //         let publicKey = getUserPublicKey(user.did!);

        //         let registryInfo = await registerUser(
        //             user.did!,
        //             user.name!,
        //             user.email!,
        //             values._password,
        //             user.handle!,
        //             user.type!,
        //             currentServerSettings.did!,
        //             currentServerSettings.registryUrl,
        //             publicKey,
        //             user.picture?.url,
        //         );

        //         // update user with registry info
        //         //await updateUser({ _id: user._id, activeRegistryInfo: registryInfo });
        //     } catch (error) {
        //         console.log("Failed to register user with registry", error);
        //     }
        // }

        let privateUser = await getUserPrivate(user.did!);
        return {
            success: true,
            message: "User signed up successfully",
            data: {
                user: privateUser,
                devVerificationToken: process.env.NODE_ENV !== "production" ? user.devVerificationToken ?? null : null,
                devVerificationUrl: process.env.NODE_ENV !== "production" ? user.devVerificationUrl ?? null : null,
            },
        };
    } catch (error) {
        if (error instanceof AuthenticationError) {
            return { success: false, message: error.message };
        } else if (error instanceof Error) {
            return { success: false, message: error.message };
        } else {
            return { success: false, message: "Failed to sign up the user. " + JSON.stringify(error) };
        }
    }
};
