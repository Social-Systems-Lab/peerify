// Per-account email send limit: a cooldown between sends plus a cap per rolling window.
// Shared by the verification resend and the login link; free of database imports so it can be
// unit-tested directly.

export type SendLimitState = {
    lastSentAt?: Date | null;
    windowStart?: Date | null;
    sendCount?: number | null;
};

export type SendLimitConfig = {
    cooldownSeconds: number;
    cap: number;
    windowMs: number;
};

export type SendLimitDecision =
    | { allowed: true; windowStart: Date; sendCount: number }
    | { allowed: false; reason: "cooldown" | "daily_cap"; retryAfterSeconds: number };

// The window opens with the first counted send after the previous window has run out.
export const evaluateSendLimit = (state: SendLimitState, config: SendLimitConfig, now: Date): SendLimitDecision => {
    const windowStart = state.windowStart ?? null;
    const windowOpen = windowStart !== null && now.getTime() - windowStart.getTime() < config.windowMs;
    const sendsInWindow = windowOpen ? (state.sendCount ?? 0) : 0;

    if (windowStart !== null && windowOpen && sendsInWindow >= config.cap) {
        const remainingMs = windowStart.getTime() + config.windowMs - now.getTime();
        return { allowed: false, reason: "daily_cap", retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
    }

    const lastSentAt = state.lastSentAt ?? null;
    if (lastSentAt !== null) {
        const remainingMs = lastSentAt.getTime() + config.cooldownSeconds * 1000 - now.getTime();
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
