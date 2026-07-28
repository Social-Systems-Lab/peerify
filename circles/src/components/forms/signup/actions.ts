"use server";

import crypto from "crypto";
import { FormSubmitResponse, UserPrivate } from "../../../models/models";
import { AuthenticationError, createUserSession, createUserAccount } from "@/lib/auth/auth";
import { updateCircle, createCircle, getCircleByHandle } from "@/lib/data/circle";
import { addMember } from "@/lib/data/member";
import { getUserPrivate } from "@/lib/data/user";
import { ensureWelcomeMessageForNewUser } from "@/lib/data/mongo-chat";
import { getResolvedWelcomeTemplate } from "@/lib/data/system-message-templates";
import { verifyAltchaPayload } from "@/lib/auth/altcha";
import { generateSlug } from "@/lib/utils";
import { generateLocalDidAndPublicKey } from "@/lib/auth/vibe-id";
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
// maybeAutoPublishPilotArtistCircle in src/lib/data/circle.ts for the auto-transition
// to "published" once picture + About text + Community Guidelines are all complete.
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

export const submitSignupFormAction = async (values: Record<string, any>): Promise<FormSubmitResponse> => {
    try {
        const altchaOk = await verifyAltchaPayload(values.altcha);
        if (!altchaOk) {
            return { success: false, message: "Please complete the human-verification check." };
        }

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
        const requestedMetadata =
            values.metadata && typeof values.metadata === "object" && !Array.isArray(values.metadata)
                ? values.metadata
                : undefined;

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
