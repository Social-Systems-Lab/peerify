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

// Failed attempts per key, with a delay that grows after a few free failures instead of a hard
// lockout: nobody can lock someone else out for long, and the owner keeps other ways in (the login
// link). The counter is forgotten FAILURE_MEMORY_MS after the last failure, or cleared on success.
export const FAILURE_FREE_ATTEMPTS = 5;
const FAILURE_BASE_DELAY_SECONDS = 30;
const FAILURE_MAX_DELAY_SECONDS = 15 * 60;
const FAILURE_MEMORY_MS = 24 * 3600 * 1000;

// After `failures` failed attempts, how long the next one has to wait: none for the first
// FAILURE_FREE_ATTEMPTS - 1, then 30 s doubling per failure (60 s, 2 min, 4 min, 8 min), capped at 15 min.
export const failureDelaySeconds = (failures: number): number =>
    failures < FAILURE_FREE_ATTEMPTS
        ? 0
        : Math.min(FAILURE_BASE_DELAY_SECONDS * 2 ** (failures - FAILURE_FREE_ATTEMPTS), FAILURE_MAX_DELAY_SECONDS);

export const checkFailureDelay = async (key: string, now: Date = new Date()): Promise<MinimumWaitResult> => {
    const doc = await RateLimits.findOne({ _id: key }, { projection: { until: 1, expiresAt: 1 } });
    if (!doc || doc.expiresAt <= now || doc.until <= now) {
        return { allowed: true };
    }
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((doc.until.getTime() - now.getTime()) / 1000)) };
};

// Counts one failure and starts the delay it earns. Concurrent failures each count ($inc); the
// delay only ever grows ($max).
export const recordFailure = async (key: string, now: Date = new Date()): Promise<{ failures: number }> => {
    // A counter older than its memory starts over (the TTL index removes it only eventually).
    await RateLimits.deleteOne({ _id: key, expiresAt: { $lte: now } });
    const count = () =>
        RateLimits.findOneAndUpdate(
            { _id: key },
            {
                $inc: { failures: 1 },
                $set: { expiresAt: new Date(now.getTime() + FAILURE_MEMORY_MS) },
                $setOnInsert: { until: now },
            },
            { upsert: true, returnDocument: "after" },
        );
    let counted;
    try {
        counted = await count();
    } catch (error) {
        // Two first failures at once: both upserts try to insert, one gets 11000. By now the
        // document exists, so a second try is an ordinary update.
        if ((error as { code?: unknown })?.code !== 11000) {
            throw error;
        }
        counted = await count();
    }
    const failures = counted?.failures ?? 1;
    const delay = failureDelaySeconds(failures);
    if (delay > 0) {
        await RateLimits.findOneAndUpdate({ _id: key }, { $max: { until: new Date(now.getTime() + delay * 1000) } });
    }
    return { failures };
};

export const clearFailures = async (key: string): Promise<void> => {
    await RateLimits.deleteOne({ _id: key });
};
