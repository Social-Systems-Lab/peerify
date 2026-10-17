"use server";

import { z } from "zod";
import { FormSubmitResponse, emailSchema } from "../../../models/models";
import { AuthenticationError, authenticateUser, burnPasswordCheck, createUserSession } from "@/lib/auth/auth";
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

// One reply for an unknown address, a wrong password and missing key files, so the form never
// reveals whether an account exists. All three also cost the same key derivation.
const LOGIN_FAILED_MESSAGE = "Email or password is incorrect";
// Per client IP, across all addresses: short, because people retry right after a typo. Each attempt
// also needs a freshly solved ALTCHA.
const PASSWORD_LOGIN_IP_WAIT_SECONDS = 5;
const PASSWORD_MAX_LENGTH = 1024;

export const submitLoginFormAction = async (values: Record<string, any>): Promise<FormSubmitResponse> => {
    try {
        const emailInput = typeof values.email === "string" ? values.email : "";
        const normalizedEmail = emailInput.trim();
        const password = typeof values.password === "string" ? values.password : "";
        if (!normalizedEmail || !password || password.length > PASSWORD_MAX_LENGTH) {
            return { success: false, message: LOGIN_FAILED_MESSAGE };
        }

        if (!(await verifyAltchaPayload(typeof values.altcha === "string" ? values.altcha : undefined))) {
            return { success: false, message: "Please complete the human-verification check." };
        }

        const clientIp = getClientIp(await headers()) ?? "unknown";
        const ipClaim = await claimMinimumWait(
            rateLimitKey("login-password:ip", clientIp),
            PASSWORD_LOGIN_IP_WAIT_SECONDS,
        );
        if (!ipClaim.allowed) {
            return {
                success: false,
                message: `Please wait ${ipClaim.retryAfterSeconds} seconds before trying again.`,
            };
        }

        if (process.env.NODE_ENV !== "production") {
            console.log(`[LOGIN_DIAG] email=${maskEmail(normalizedEmail)}`);
        }

        // One case-insensitive query, the same for known and unknown addresses (a second lookup only
        // for misses would make unknown addresses measurably slower).
        const user = await Circles.findOne(
            { email: normalizedEmail },
            { collation: { locale: "en", strength: 2 } },
        );

        if (!user?.did) {
            console.error(`Login failed: no account for ${maskEmail(normalizedEmail)}`);
            burnPasswordCheck(password);
            return { success: false, message: LOGIN_FAILED_MESSAGE };
        }

        authenticateUser(user.did, password);

        let privateUser = await getUserPrivate(user.did);
        await createUserSession(privateUser, user.did);

        return { success: true, message: "User authenticated successfully", data: { user: privateUser } };
    } catch (error) {
        if (error instanceof AuthenticationError) {
            if (process.env.NODE_ENV !== "production") {
                console.log(`[LOGIN_DIAG] verificationBranch=auth_error message="${error.message}"`);
            }
            return { success: false, message: LOGIN_FAILED_MESSAGE };
        }

        if (error instanceof Error) {
            const errorText = `${error.name}: ${error.message}`;
            const isDbError = /(mongo|topology|econnrefused|connection|timed out|server selection)/i.test(errorText);

            console.error("Login failed with non-auth error", {
                email: maskEmail(typeof values?.email === "string" ? values.email.trim() : ""),
                error: redactEmailAddresses(errorText),
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
