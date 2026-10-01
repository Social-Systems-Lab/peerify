// Shared pieces of the signup email-verification flow: the link format and the resend rate limit.
// Kept free of database imports so the limit logic can be unit-tested directly.

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

export type VerificationResendDecision =
    | { allowed: true; windowStart: Date; sendCount: number }
    | { allowed: false; reason: "cooldown" | "daily_cap"; retryAfterSeconds: number };

// emailVerificationLastSentAt is set by the initial signup send as well as every resend, so the
// first resend also waits out the cooldown. The daily cap counts resends only, in a 24h window
// that opens with the first resend after the previous window has run out.
export const evaluateVerificationResend = (state: VerificationResendState, now: Date): VerificationResendDecision => {
    const windowStart = state.emailVerificationSendWindowStart ?? null;
    const windowOpen = windowStart !== null && now.getTime() - windowStart.getTime() < VERIFICATION_RESEND_WINDOW_MS;
    const sendsInWindow = windowOpen ? (state.emailVerificationSendCount24h ?? 0) : 0;

    if (windowStart !== null && windowOpen && sendsInWindow >= VERIFICATION_RESEND_DAILY_CAP) {
        const remainingMs = windowStart.getTime() + VERIFICATION_RESEND_WINDOW_MS - now.getTime();
        return { allowed: false, reason: "daily_cap", retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
    }

    const lastSentAt = state.emailVerificationLastSentAt ?? null;
    if (lastSentAt !== null) {
        const remainingMs = lastSentAt.getTime() + VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000 - now.getTime();
        if (remainingMs > 0) {
            return { allowed: false, reason: "cooldown", retryAfterSeconds: Math.ceil(remainingMs / 1000) };
        }
    }

    return {
        allowed: true,
        windowStart: windowStart !== null && windowOpen ? windowStart : now,
        sendCount: sendsInWindow + 1,
    };
};
