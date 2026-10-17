"use server";

import { Circles } from "@/lib/data/db";
import { trySendEmail, generateSecureToken, hashToken, redactEmailAddresses } from "@/lib/data/email";
import { headers } from "next/headers";
import { z } from "zod";
import { emailSchema } from "@/models/models"; // Assuming emailSchema is in models
import { maskEmail } from "@/lib/utils/mask-email";
import { verifyAltchaPayload } from "@/lib/auth/altcha";
import { evaluateSendLimit, type SendLimitConfig } from "@/lib/auth/send-limits";
import { claimMinimumWait, rateLimitKey } from "@/lib/data/rate-limit";
import { getClientIp } from "@/lib/utils/client-ip";

interface RequestPasswordResetResponse {
    success: boolean;
    message: string;
}

const requestResetSchema = z.object({
    email: emailSchema,
});

function normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, "");
}

function isLocalHost(hostname: string): boolean {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

// Exported so requestLoginLinkAction (src/components/forms/login/actions.ts) can reuse the
// same base-url resolution (docker/local/prod handling) instead of duplicating it.
export async function resolveResetBaseUrl(): Promise<string> {
    const explicitBaseUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.APP_URL ||
        process.env.SITE_URL ||
        (process.env.NODE_ENV === "production" ? process.env.CIRCLES_URL : undefined);

    let requestOrigin: string | undefined;
    try {
        const h = await headers();
        const originHeader = h.get("origin");
        if (originHeader) {
            requestOrigin = new URL(originHeader).origin;
        } else {
            const host = h.get("x-forwarded-host") || h.get("host");
            const proto = h.get("x-forwarded-proto") || (process.env.NODE_ENV === "production" ? "https" : "http");
            if (host) {
                requestOrigin = `${proto}://${host}`;
            }
        }
    } catch {
        // No request scope (e.g., direct script invocation)
    }

    const fallbackUrl = process.env.CIRCLES_URL || "http://localhost:3000";
    let baseUrl = explicitBaseUrl || requestOrigin || fallbackUrl;

    // Guard against internal docker host links in all local-style runs.
    // If configured base is internal-only (e.g. http://db), prefer request origin.
    try {
        const parsed = new URL(baseUrl);
        if (parsed.hostname === "db") {
            baseUrl = requestOrigin || "http://localhost:3000";
        }
    } catch {
        baseUrl = requestOrigin || "http://localhost:3000";
    }

    return normalizeBaseUrl(baseUrl);
}

// The same reply whether the address is unknown, unverified, verified, or over its per-account
// limit, so the form never reveals whether an account exists or is verified.
const PASSWORD_RESET_GENERIC_MESSAGE =
    "If an account with that email exists and is verified, a password reset link has been sent.";

const PASSWORD_RESET_SEND_LIMIT: SendLimitConfig = {
    cooldownSeconds: 60,
    cap: 5,
    windowMs: 24 * 3600 * 1000,
};
// Per client IP, across all addresses. Its refusal is independent of any account, so it can say so.
const PASSWORD_RESET_IP_WAIT_SECONDS = 20;

// Only verified addresses get a link. ALTCHA, a per-IP minimum wait and a per-account cooldown +
// daily cap (state on the user doc, like the login link) keep the form from flooding an inbox.
export async function requestPasswordResetAction(email: string, altcha?: string): Promise<RequestPasswordResetResponse> {
    const trimmedEmail = typeof email === "string" ? email.trim() : "";
    const validation = requestResetSchema.safeParse({ email: trimmedEmail });
    if (!validation.success) {
        return { success: false, message: "Invalid email address provided." };
    }

    if (!(await verifyAltchaPayload(altcha))) {
        return { success: false, message: "Please complete the human-verification check." };
    }

    try {
        const clientIp = getClientIp(await headers()) ?? "unknown";
        const ipClaim = await claimMinimumWait(
            rateLimitKey("password-reset:ip", clientIp),
            PASSWORD_RESET_IP_WAIT_SECONDS,
        );
        if (!ipClaim.allowed) {
            return {
                success: false,
                message: `Please wait ${ipClaim.retryAfterSeconds} seconds before requesting another reset link.`,
            };
        }

        // Signup stores addresses lowercased; also match the input as typed so any legacy
        // mixed-case record still resolves. Exact matches only, no regex.
        const user = await Circles.findOne({
            email: { $in: Array.from(new Set([trimmedEmail, trimmedEmail.toLowerCase()])) },
        });

        if (!user) {
            console.log(`Password reset requested for unknown address ${maskEmail(trimmedEmail)}`);
            return { success: true, message: PASSWORD_RESET_GENERIC_MESSAGE };
        }
        if (user.isEmailVerified !== true) {
            console.log(`Password reset not sent for user ${user.did}: email not verified`);
            return { success: true, message: PASSWORD_RESET_GENERIC_MESSAGE };
        }

        const now = new Date();
        const decision = evaluateSendLimit(
            {
                lastSentAt: user.passwordResetLastSentAt,
                windowStart: user.passwordResetSendWindowStart,
                sendCount: user.passwordResetSendCount24h,
            },
            PASSWORD_RESET_SEND_LIMIT,
            now,
        );
        if (!decision.allowed) {
            console.log(`Password reset not sent for user ${user.did}: ${decision.reason}`);
            return { success: true, message: PASSWORD_RESET_GENERIC_MESSAGE };
        }

        const unhashedToken = generateSecureToken();
        const hashedToken = hashToken(unhashedToken);
        const expiry = new Date(now.getTime() + 3600 * 1000); // 1 hour expiry

        // Compare-and-set on the passwordResetLastSentAt just read (null also matches a missing
        // field), so two concurrent requests can't both pass the limit.
        const claim = await Circles.updateOne(
            { _id: user._id, passwordResetLastSentAt: user.passwordResetLastSentAt ?? null },
            {
                $set: {
                    passwordResetToken: hashedToken,
                    passwordResetTokenExpiry: expiry,
                    passwordResetLastSentAt: now,
                    passwordResetSendWindowStart: decision.windowStart,
                    passwordResetSendCount24h: decision.sendCount,
                },
            },
        );
        if (claim.matchedCount === 0) {
            console.log(`Password reset not sent for user ${user.did}: concurrent request`);
            return { success: true, message: PASSWORD_RESET_GENERIC_MESSAGE };
        }

        const baseUrl = await resolveResetBaseUrl();
        const resetLink = `${baseUrl}/reset-password?token=${unhashedToken}`;
        let isLocalBaseUrl = false;
        try {
            isLocalBaseUrl = isLocalHost(new URL(baseUrl).hostname);
        } catch {
            isLocalBaseUrl = false;
        }
        const shouldLogResetLink =
            isLocalBaseUrl ||
            (process.env.CIRCLES_DEV_LOG_PASSWORD_RESET === "true" && process.env.NODE_ENV !== "production");

        if (shouldLogResetLink) {
            console.log(`[DEV_RESET_LINK] email=${maskEmail(user.email)} url=${resetLink} token=${unhashedToken}`);
        }

        const sendResult = await trySendEmail({
            to: user.email!,
            templateAlias: "password-reset",
            templateModel: {
                name: user.name || "User",
                actionUrl: resetLink,
                product_name: "Peerify",
                product_url: baseUrl,
                support_url: `${baseUrl}/support`,
            },
        });
        if (sendResult.ok) {
            console.log(`Password reset email sent for user ${user.did} (MessageID ${sendResult.messageId})`);
        } else {
            console.error(`Password reset email NOT sent for user ${user.did}: ${sendResult.reason}`);
        }

        return { success: true, message: PASSWORD_RESET_GENERIC_MESSAGE };
    } catch (error) {
        console.error(
            "Error during password reset request:",
            error instanceof Error ? redactEmailAddresses(error.message) : "unknown error",
        );
        // Generic error for unexpected issues, but still avoid confirming/denying email existence.
        return { success: false, message: "An error occurred while processing your request. Please try again later." };
    }
}
