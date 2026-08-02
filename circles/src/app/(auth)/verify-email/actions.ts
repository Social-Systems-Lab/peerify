"use server";

import { Circles } from "@/lib/data/db";
import { hashToken } from "@/lib/data/email";
import { revalidatePath } from "next/cache";
import { createUserSession } from "@/lib/auth/auth";
import { getUserPrivate } from "@/lib/data/user";
import { getAutoProvisionedArtistCircle, getCirclePublishStatus } from "@/lib/data/circle";

interface VerifyEmailResponse {
    success: boolean;
    message: string;
    redirectPath?: string;
}

// Artist-path pilot signups auto-provision a public artist circle alongside the personal
// one (see createPilotArtistCircle in src/components/forms/signup/actions.ts), but the
// two-step onboarding sequence (personal profile "Step 1 of 2" -> artist circle "Step 2 of
// 2", see about-settings-form.tsx / settings/about/page.tsx) starts on the PERSONAL
// profile's Settings/About page — that's where the step 1 fields (picture, About,
// CommunityGuidelinesSettingsCard) actually live, not the artist circle's Home tab. Once the
// artist circle has been published (manually, via the "Publish circle" button once
// isPilotArtistCircleReadyToPublish is true — see src/lib/data/circle.ts), there's no more
// onboarding to walk them through, so a later email-verification click (e.g. an
// already-consumed/expired link) just lands them on their personal profile's Home tab like
// anyone else. Fan-path signups have no auto-provisioned
// artist circle at all, so this is a no-op for them and they land on their personal
// profile's Home tab exactly as before.
const resolveLandingPath = async (did: string, fallbackHandle?: string | null): Promise<string | undefined> => {
    if (!fallbackHandle) {
        const artistCircle = await getAutoProvisionedArtistCircle(did);
        return artistCircle?.handle ? `/circles/${artistCircle.handle}` : undefined;
    }

    const artistCircle = await getAutoProvisionedArtistCircle(did);
    const isArtistOnboardingInProgress = artistCircle && getCirclePublishStatus(artistCircle) !== "published";

    return isArtistOnboardingInProgress ? `/circles/${fallbackHandle}/settings/about` : `/circles/${fallbackHandle}`;
};

export async function verifyEmailAction(token: string): Promise<VerifyEmailResponse> {
    if (!token) {
        return { success: false, message: "Verification token is missing." };
    }

    try {
        const hashedToken = hashToken(token);

        const user = await Circles.findOne({
            emailVerificationToken: hashedToken,
        });

        if (!user) {
            return { success: false, message: "Invalid or expired verification token." };
        }

        if (user.isEmailVerified) {
            await Circles.updateOne(
                { _id: user._id },
                {
                    $set: {
                        emailVerificationToken: null,
                        emailVerificationTokenExpiry: null,
                    },
                },
            );
            // A valid (if already-consumed) token still proves ownership of this account, so establish a
            // session here too — otherwise a link that was pre-fetched by an email scanner (or double-clicked)
            // would leave the browser unauthenticated and break the "Continue to profile" hop that follows.
            if (user.did) {
                const privateUser = await getUserPrivate(user.did);
                await createUserSession(privateUser, user.did);
            }
            return {
                success: false,
                message: "This email verification link has already been used. You can log in.",
                redirectPath: user.did
                    ? await resolveLandingPath(user.did, user.handle)
                    : user.handle
                      ? `/circles/${user.handle}`
                      : undefined,
            };
        }

        if (user.emailVerificationTokenExpiry && new Date() > user.emailVerificationTokenExpiry) {
            // Optionally, you could offer to resend the verification email here
            // For now, just inform the user the token is expired.
            // Clear the expired token
            await Circles.updateOne(
                { _id: user._id },
                {
                    $set: {
                        emailVerificationToken: null,
                        emailVerificationTokenExpiry: null,
                    },
                },
            );
            if (user.did) {
                const privateUser = await getUserPrivate(user.did);
                await createUserSession(privateUser, user.did);
            }
            return { success: false, message: "This email verification link has expired. Please request a new one." };
        }
        if (!user.did) {
            return { success: false, message: "Could not verify this account. Please contact support." };
        }

        // Token is valid and not expired, verify the email
        const updateResult = await Circles.updateOne(
            { _id: user._id },
            {
                $set: {
                    isEmailVerified: true,
                    emailVerificationToken: null,
                    emailVerificationTokenExpiry: null,
                },
            },
        );

        if (updateResult.modifiedCount === 0) {
            // This might happen if the user was updated between findOne and updateOne
            console.warn(
                `Failed to update email verification status for user ${user._id?.toString()}, but token was valid.`,
            );
            return { success: false, message: "Could not update email verification status. Please try again." };
        }

        // Revalidate user-specific paths if necessary, e.g., profile page
        if (user.handle) {
            try {
                revalidatePath(`/circles/${user.handle}`);
            } catch (revalidationError) {
                console.warn("Failed to revalidate user path after email verification:", revalidationError);
            }
        }

        // Clicking the emailed verification link is very often the first request this browser has made to the
        // app (a different tab, device, or in-app browser than the one used to sign up), so it usually carries
        // no session cookie at all. Without establishing one here, the "Continue to profile setup" hop lands on
        // /circles/{handle}/home as an anonymous viewer — isOwnUserProfile is never true, so the welcome dialog
        // (and any other own-profile-only UI) never triggers, unlike the check-email page's fallback link, which
        // stays inside the already-authenticated signup tab.
        const privateUser = await getUserPrivate(user.did);
        await createUserSession(privateUser, user.did);

        // This branch only ever runs once per account — the moment isEmailVerified flips
        // false->true for the first time. Every later visit to a (now-consumed) verification
        // link falls into the "already verified" branch above, which still uses
        // resolveLandingPath. That makes this the exact, one-time "new signup" moment, so it's
        // the only place that should ever route into the new card-based onboarding sequence
        // (src/app/onboarding/pilot) — existing accounts can never land here again.
        return {
            success: true,
            message: "Email verified",
            redirectPath: "/onboarding/pilot",
        };
    } catch (error) {
        console.error("Error during email verification:", error);
        return { success: false, message: "An unexpected error occurred during email verification." };
    }
}
