"use server";

import { Circles } from "@/lib/data/db";
import { hashToken } from "@/lib/data/email";
import { revalidatePath } from "next/cache";
import { createUserSession } from "@/lib/auth/auth";
import { getUserPrivate } from "@/lib/data/user";

interface VerifyEmailResponse {
    success: boolean;
    message: string;
    handle?: string;
}

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
                handle: user.handle || undefined,
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

        return {
            success: true,
            message: "Email verified",
            handle: user.handle || undefined,
        };
    } catch (error) {
        console.error("Error during email verification:", error);
        return { success: false, message: "An unexpected error occurred during email verification." };
    }
}
