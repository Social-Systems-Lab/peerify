"use server";

import { z } from "zod";
import { FormSubmitResponse, emailSchema } from "../../../models/models";
import { AuthenticationError, authenticateUser, createUserSession, USERS_DIR } from "@/lib/auth/auth";
import { Circles } from "@/lib/data/db";
import { getUserPrivate } from "@/lib/data/user";
import { sendEmail, generateSecureToken, hashToken } from "@/lib/data/email";
import { resolveResetBaseUrl } from "@/app/(auth)/forgot-password/actions";
import fs from "fs";
import path from "path";

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const submitLoginFormAction = async (values: Record<string, any>): Promise<FormSubmitResponse> => {
    try {
        const emailInput = typeof values.email === "string" ? values.email : "";
        const normalizedEmail = emailInput.trim();
        let password = values.password;

        if (process.env.NODE_ENV !== "production") {
            console.log(`[LOGIN_DIAG] normalizedEmail='${normalizedEmail.toLowerCase()}'`);
        }

        // Prefer exact email lookup with case-insensitive collation for deterministic matching.
        let user = await Circles.findOne(
            { email: normalizedEmail },
            { collation: { locale: "en", strength: 2 } },
        );
        if (!user) {
            // Fallback for legacy records: exact escaped regex (still case-insensitive).
            const emailRegex = new RegExp(`^${escapeRegExp(normalizedEmail)}$`, "i");
            user = await Circles.findOne({ email: { $regex: emailRegex } });
        }

        if (!user) {
            console.error("Login failed: Account does not exist for email:", normalizedEmail);
            throw new AuthenticationError("Account does not exist");
        }
        if (process.env.NODE_ENV !== "production") {
            const credentialPath = path.join(USERS_DIR, user.did || "");
            console.log(
                `[LOGIN_DIAG] userId=${user._id?.toString()} did=${user.did} credentialSource=file path=${credentialPath} exists=${fs.existsSync(
                    credentialPath,
                )}`,
            );
        }

        // Check if email is verified
        // TEMPORARILY DISABLED FOR TESTING
        /*
        if (!user.isEmailVerified) {
            // Optionally, trigger a resend of verification email here
            // For now, just inform the user.
            // You could add a specific error code or flag to the response
            // to allow the frontend to show a "Resend verification email" button.
            return {
                success: false,
                message: "Email not verified. Please check your inbox for the verification link.",
                // errorCode: "EMAIL_NOT_VERIFIED" // Example for frontend handling
            };
        }
        */

        authenticateUser(user.did!, password);

        let privateUser = await getUserPrivate(user.did!);
        await createUserSession(privateUser, user.did!);

        return { success: true, message: "User authenticated successfully", data: { user: privateUser } };
    } catch (error) {
        if (error instanceof AuthenticationError) {
            if (process.env.NODE_ENV !== "production") {
                const reason =
                    error.message === "Account does not exist"
                        ? "missing_user_or_credentials"
                        : error.message === "Incorrect password"
                          ? "password_mismatch"
                          : "auth_error";
                console.log(`[LOGIN_DIAG] verificationBranch=${reason} message="${error.message}"`);
            }
            return { success: false, message: error.message };
        }

        if (error instanceof Error) {
            const errorText = `${error.name}: ${error.message}`;
            const isDbError = /(mongo|topology|econnrefused|connection|timed out|server selection)/i.test(errorText);

            console.error("Login failed with non-auth error", {
                email: typeof values?.email === "string" ? values.email.trim() : values?.email,
                error: errorText,
            });

            if (isDbError) {
                return { success: false, message: "Login is temporarily unavailable due to a database issue." };
            }

            return { success: false, message: "Login failed due to a server error. Please try again." };
        }

        console.error("Login failed with unknown error", error);
        return { success: false, message: "Login failed due to an unexpected error. Please try again." };
    }
};

const requestLoginLinkSchema = z.object({ email: emailSchema });

interface RequestLoginLinkResponse {
    success: boolean;
    message: string;
}

// Available to any account, not just pilot-signup/magic-link ones — the login form has
// no way to know which login method a given account was set up with, and this is meant
// to be a plain alternative to password login, not a "recover access" flow (that's
// forgot-password, which implies a password existed in the first place). Reuses the
// same token/email pattern as requestPasswordResetAction
// (src/app/(auth)/forgot-password/actions.ts) — including the anti-enumeration generic
// response — via resolveResetBaseUrl and the shared token helpers. The token is stored
// in loginLinkToken/loginLinkTokenExpiry (separate from passwordResetToken) and
// consumed by consumeLoginLink (src/lib/auth/actions.ts), which only establishes a
// session rather than rotating password credentials.
export const requestLoginLinkAction = async (email: string): Promise<RequestLoginLinkResponse> => {
    const validation = requestLoginLinkSchema.safeParse({ email });
    if (!validation.success) {
        return { success: false, message: "Invalid email address provided." };
    }

    try {
        const user = await Circles.findOne({ email: validation.data.email });

        if (user) {
            const unhashedToken = generateSecureToken();
            const hashedToken = hashToken(unhashedToken);
            // 24-hour expiry, matching the original signup verification link (this is
            // functionally the same category of link — low-risk, "get me in" — not a
            // credential-changing action like password reset, which uses a 1-hour expiry.
            const expiry = new Date(Date.now() + 24 * 3600 * 1000);

            await Circles.updateOne(
                { _id: user._id },
                { $set: { loginLinkToken: hashedToken, loginLinkTokenExpiry: expiry } },
            );

            const baseUrl = await resolveResetBaseUrl();
            const loginLink = `${baseUrl}/login-link?token=${unhashedToken}`;

            if (process.env.NODE_ENV !== "production") {
                console.log(`[DEV_LOGIN_LINK] email=${user.email} url=${loginLink} token=${unhashedToken}`);
            }

            try {
                await sendEmail({
                    to: user.email!,
                    // Reuses the existing signup-verification template rather than a
                    // brand new Postmark template; needs an actionText/introText merge
                    // field added there (or a dedicated "login-link" template created)
                    // before this copy reaches recipients as intended.
                    templateAlias: "email-verification",
                    templateModel: {
                        name: user.name || "User",
                        actionUrl: loginLink,
                        actionText: "Log in",
                        introText: "Click the button below to log in to Peerify. No password needed.",
                    },
                });
            } catch (emailError) {
                console.error(`Failed to send login link email to ${user.email}:`, emailError);
            }
        } else {
            console.log(`Login link requested for non-existent email: ${validation.data.email}`);
        }

        // Always return a generic success message to prevent email enumeration.
        return {
            success: true,
            message: "If an account with that email exists, a login link has been sent.",
        };
    } catch (error) {
        console.error("Error during login link request:", error);
        return {
            success: false,
            message: "An error occurred while processing your request. Please try again later.",
        };
    }
};
