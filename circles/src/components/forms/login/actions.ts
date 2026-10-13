"use server";

import { z } from "zod";
import { FormSubmitResponse, emailSchema } from "../../../models/models";
import { AuthenticationError, authenticateUser, createUserSession, USERS_DIR } from "@/lib/auth/auth";
import { Circles } from "@/lib/data/db";
import { getUserPrivate } from "@/lib/data/user";
import { trySendEmail, generateSecureToken, hashToken, redactEmailAddresses } from "@/lib/data/email";
import { resolveResetBaseUrl } from "@/app/(auth)/forgot-password/actions";
import { verifyAltchaPayload } from "@/lib/auth/altcha";
import { evaluateSendLimit, type SendLimitConfig } from "@/lib/auth/send-limits";
import { claimMinimumWait, rateLimitKey } from "@/lib/data/rate-limit";
import { getClientIp } from "@/lib/utils/client-ip";
import { maskEmail } from "@/lib/utils/mask-email";
import { headers } from "next/headers";
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
            console.log(`[LOGIN_DIAG] email=${maskEmail(normalizedEmail)}`);
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
            console.error(`Login failed: no account for ${maskEmail(normalizedEmail)}`);
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

// The same reply whether the address is unknown, unverified, verified, or over its per-account
// limit, so the form never reveals whether an account exists or is verified.
const LOGIN_LINK_GENERIC_MESSAGE =
    "If a verified account uses that email address, a login link is on its way. Not verified yet? Use the link in your signup email.";

const LOGIN_LINK_SEND_LIMIT: SendLimitConfig = {
    cooldownSeconds: 60,
    cap: 5,
    windowMs: 24 * 3600 * 1000,
};
// Per client IP, across all addresses. Its refusal is independent of any account, so it can say so.
const LOGIN_LINK_IP_WAIT_SECONDS = 20;

// Available to any account, not just pilot-signup/magic-link ones — the login form has
// no way to know which login method a given account was set up with, and this is meant
// to be a plain alternative to password login, not a "recover access" flow (that's
// forgot-password, which implies a password existed in the first place). Reuses the
// same token/email pattern as requestPasswordResetAction
// (src/app/(auth)/forgot-password/actions.ts) via resolveResetBaseUrl and the shared token
// helpers. The token is stored in loginLinkToken/loginLinkTokenExpiry (separate from
// passwordResetToken) and consumed by consumeLoginLink (src/lib/auth/actions.ts), which only
// establishes a session rather than rotating password credentials.
//
// Only accounts with a verified email get a link: bots sign up with strangers' addresses and
// then used this form to mail them again. ALTCHA, a per-IP minimum wait and a per-account
// cooldown + daily cap (state on the user doc, like the verification resend) limit the rest.
export const requestLoginLinkAction = async (email: string, altcha?: string): Promise<RequestLoginLinkResponse> => {
    const trimmedEmail = typeof email === "string" ? email.trim() : "";
    const validation = requestLoginLinkSchema.safeParse({ email: trimmedEmail });
    if (!validation.success) {
        return { success: false, message: "Invalid email address provided." };
    }

    if (!(await verifyAltchaPayload(altcha))) {
        return { success: false, message: "Please complete the human-verification check." };
    }

    try {
        const clientIp = getClientIp(await headers()) ?? "unknown";
        const ipClaim = await claimMinimumWait(rateLimitKey("login-link:ip", clientIp), LOGIN_LINK_IP_WAIT_SECONDS);
        if (!ipClaim.allowed) {
            return {
                success: false,
                message: `Please wait ${ipClaim.retryAfterSeconds} seconds before requesting another login link.`,
            };
        }

        // Signup stores addresses lowercased; also match the input as typed so any legacy
        // mixed-case record still resolves. Exact matches only, no regex.
        const user = await Circles.findOne({
            email: { $in: Array.from(new Set([trimmedEmail, trimmedEmail.toLowerCase()])) },
        });

        if (!user) {
            console.log(`Login link requested for unknown address ${maskEmail(trimmedEmail)}`);
            return { success: true, message: LOGIN_LINK_GENERIC_MESSAGE };
        }
        if (user.isEmailVerified !== true) {
            console.log(`Login link not sent for user ${user.did}: email not verified`);
            return { success: true, message: LOGIN_LINK_GENERIC_MESSAGE };
        }

        const now = new Date();
        const decision = evaluateSendLimit(
            {
                lastSentAt: user.loginLinkLastSentAt,
                windowStart: user.loginLinkSendWindowStart,
                sendCount: user.loginLinkSendCount24h,
            },
            LOGIN_LINK_SEND_LIMIT,
            now,
        );
        if (!decision.allowed) {
            console.log(`Login link not sent for user ${user.did}: ${decision.reason}`);
            return { success: true, message: LOGIN_LINK_GENERIC_MESSAGE };
        }

        const unhashedToken = generateSecureToken();
        const hashedToken = hashToken(unhashedToken);
        // 24-hour expiry, matching the original signup verification link (this is
        // functionally the same category of link — low-risk, "get me in" — not a
        // credential-changing action like password reset, which uses a 1-hour expiry.
        const expiry = new Date(now.getTime() + 24 * 3600 * 1000);

        // Compare-and-set on the loginLinkLastSentAt just read (null also matches a missing
        // field), so two concurrent requests can't both pass the limit.
        const claim = await Circles.updateOne(
            { _id: user._id, loginLinkLastSentAt: user.loginLinkLastSentAt ?? null },
            {
                $set: {
                    loginLinkToken: hashedToken,
                    loginLinkTokenExpiry: expiry,
                    loginLinkLastSentAt: now,
                    loginLinkSendWindowStart: decision.windowStart,
                    loginLinkSendCount24h: decision.sendCount,
                },
            },
        );
        if (claim.matchedCount === 0) {
            console.log(`Login link not sent for user ${user.did}: concurrent request`);
            return { success: true, message: LOGIN_LINK_GENERIC_MESSAGE };
        }

        const baseUrl = await resolveResetBaseUrl();
        const loginLink = `${baseUrl}/login-link?token=${unhashedToken}`;

        if (process.env.NODE_ENV !== "production") {
            console.log(`[DEV_LOGIN_LINK] user=${user.did} url=${loginLink} token=${unhashedToken}`);
        }

        const sendResult = await trySendEmail({
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
        if (sendResult.ok) {
            console.log(`Login link email sent for user ${user.did} (MessageID ${sendResult.messageId})`);
        } else {
            console.error(`Login link email NOT sent for user ${user.did}: ${sendResult.reason}`);
        }

        return { success: true, message: LOGIN_LINK_GENERIC_MESSAGE };
    } catch (error) {
        console.error(
            "Error during login link request:",
            error instanceof Error ? redactEmailAddresses(error.message) : "unknown error",
        );
        return {
            success: false,
            message: "An error occurred while processing your request. Please try again later.",
        };
    }
};
