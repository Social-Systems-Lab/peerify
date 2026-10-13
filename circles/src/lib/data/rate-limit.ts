import crypto from "crypto";
import { RateLimits } from "./db";

// Expired claims are only housekeeping: claimMinimumWait already ignores them.
RateLimits?.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type MinimumWaitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

// Keys hold a hash, not the raw value, so the collection never stores IP or email addresses.
export const rateLimitKey = (scope: string, value: string): string =>
    `${scope}:${crypto.createHash("sha256").update(value).digest("hex").slice(0, 32)}`;

// Claims `key` unless the previous claim is younger than waitSeconds. Atomic across processes: when
// a live claim exists the conditional filter misses, the upsert tries to insert the same _id, and
// that duplicate-key error means "too soon".
export const claimMinimumWait = async (
    key: string,
    waitSeconds: number,
    now: Date = new Date(),
): Promise<MinimumWaitResult> => {
    const until = new Date(now.getTime() + waitSeconds * 1000);
    try {
        await RateLimits.updateOne(
            { _id: key, until: { $lte: now } },
            { $set: { until, expiresAt: until } },
            { upsert: true },
        );
        return { allowed: true };
    } catch (error) {
        if ((error as { code?: unknown })?.code !== 11000) {
            throw error;
        }
        const existing = await RateLimits.findOne({ _id: key }, { projection: { until: 1 } });
        const remainingMs = existing?.until ? existing.until.getTime() - now.getTime() : waitSeconds * 1000;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
    }
};
