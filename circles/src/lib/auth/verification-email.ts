// Shared pieces of the signup email-verification flow: the link format and the resend rate limit.
// Kept free of database imports so the limit logic can be unit-tested directly.

import { evaluateSendLimit, type SendLimitDecision } from "./send-limits";

export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 3600 * 1000;
export const VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;
export const VERIFICATION_RESEND_DAILY_CAP = 5;
export const VERIFICATION_RESEND_WINDOW_MS = 24 * 3600 * 1000;

export const buildEmailVerificationLink = (unhashedToken: string): string =>
    `${process.env.CIRCLES_URL || "http://localhost:3000"}/verify-email?token=${unhashedToken}`;

export type VerificationResendState = {
    emailVerificationLastSentAt?: Date | null;
    emailVerificationSendWindowStart?: Date | null;
    emailVerificationSendCount24h?: number | null;
};

export type VerificationResendDecision = SendLimitDecision;

// emailVerificationLastSentAt is set by the initial signup send as well as every resend, so the
// first resend also waits out the cooldown. The daily cap counts resends only, in a 24h window
// that opens with the first resend after the previous window has run out.
export const evaluateVerificationResend = (state: VerificationResendState, now: Date): VerificationResendDecision =>
    evaluateSendLimit(
        {
            lastSentAt: state.emailVerificationLastSentAt,
            windowStart: state.emailVerificationSendWindowStart,
            sendCount: state.emailVerificationSendCount24h,
        },
        {
            cooldownSeconds: VERIFICATION_RESEND_COOLDOWN_SECONDS,
            cap: VERIFICATION_RESEND_DAILY_CAP,
            windowMs: VERIFICATION_RESEND_WINDOW_MS,
        },
        now,
    );
