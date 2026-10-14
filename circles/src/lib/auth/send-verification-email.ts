import { Circles } from "@/lib/data/db";
import { generateSecureToken, hashToken, trySendEmail } from "@/lib/data/email";
import {
    buildEmailVerificationLink,
    EMAIL_VERIFICATION_TOKEN_TTL_MS,
    evaluateVerificationResend,
    VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from "@/lib/auth/verification-email";

// Sends one fresh verification email to the address stored on the account, under the resend limits
// (VERIFICATION_RESEND_COOLDOWN_SECONDS, VERIFICATION_RESEND_DAILY_CAP). Shared by the signed-in
// "Resend email" button (resendVerificationEmailAction) and the admin one-off
// scripts/resend-verification-emails.ts, so both follow exactly the same rules. It never takes an
// address from the caller.

export const VERIFICATION_SUBJECT_PROJECTION = {
    did: 1,
    name: 1,
    email: 1,
    isEmailVerified: 1,
    emailVerificationLastSentAt: 1,
    emailVerificationSendWindowStart: 1,
    emailVerificationSendCount24h: 1,
} as const;

export type VerificationSubject = {
    _id?: unknown;
    did?: string;
    name?: string;
    email?: string;
    isEmailVerified?: boolean;
    emailVerificationLastSentAt?: Date | null;
    emailVerificationSendWindowStart?: Date | null;
    emailVerificationSendCount24h?: number;
};

export type SendVerificationEmailResult =
    | { status: "already_verified" }
    | { status: "no_email" }
    | { status: "rate_limited"; reason: "cooldown" | "daily_cap"; retryAfterSeconds: number }
    | { status: "sent"; messageId?: string; retryAfterSeconds: number }
    | { status: "not_sent"; reason: string };

export async function sendVerificationEmailToSubject(
    user: VerificationSubject,
    now: Date = new Date(),
): Promise<SendVerificationEmailResult> {
    if (user.isEmailVerified) return { status: "already_verified" };
    if (!user.email) return { status: "no_email" };

    const decision = evaluateVerificationResend(user as Parameters<typeof evaluateVerificationResend>[0], now);
    if (!decision.allowed) {
        return { status: "rate_limited", reason: decision.reason, retryAfterSeconds: decision.retryAfterSeconds };
    }

    // Overwriting the stored hash invalidates any earlier link. Matching on the
    // emailVerificationLastSentAt value just read (null also matches a missing field) makes
    // this a compare-and-set, so two concurrent requests can't both pass the limit.
    const unhashedToken = generateSecureToken();
    const claim = await Circles.updateOne(
        {
            _id: user._id as never,
            isEmailVerified: { $ne: true },
            emailVerificationLastSentAt: user.emailVerificationLastSentAt ?? null,
        },
        {
            $set: {
                emailVerificationToken: hashToken(unhashedToken),
                emailVerificationTokenExpiry: new Date(now.getTime() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
                emailVerificationLastSentAt: now,
                emailVerificationSendWindowStart: decision.windowStart,
                emailVerificationSendCount24h: decision.sendCount,
            },
        },
    );
    if (claim.matchedCount === 0) {
        return { status: "rate_limited", reason: "cooldown", retryAfterSeconds: VERIFICATION_RESEND_COOLDOWN_SECONDS };
    }

    const sendResult = await trySendEmail({
        to: user.email,
        templateAlias: "email-verification",
        templateModel: {
            name: user.name || "User",
            actionUrl: buildEmailVerificationLink(unhashedToken),
        },
    });
    if (!sendResult.ok) return { status: "not_sent", reason: String(sendResult.reason) };
    return { status: "sent", messageId: sendResult.messageId, retryAfterSeconds: VERIFICATION_RESEND_COOLDOWN_SECONDS };
}
