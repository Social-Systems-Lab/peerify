// Per-IP limit on misses (missing objects) at the public /storage and /uploads routes. Those routes
// serve any object to anyone with its name, and names before b2154dc6 were
// `{circleId}/{prefix}{Date.now()}`, so the millisecond was the only unknown. Counting misses
// (nearly every request of someone guessing, almost none of a normal visitor) and then refusing
// every request from that IP, hits included, makes guessing slow. Refusing only the misses would
// still let a guesser see their hits.
//
// In memory, per server process: one PM2 process per environment today, so that's one counter. A
// restart resets it, which is fine for a slowdown measure. Keyed by getClientIp (X-Real-IP from our
// nginx). Requests without it are internal, mainly next/image fetching an image for the
// optimizer, which sends no headers. Those aren't limited here: counting them in one shared bucket
// would let one person block optimized images for everyone. See the /storage plan
// (STORAGE-ACCESS-INVESTIGATION-20261028.md) for the optimizer path.

export const STORAGE_MISS_WINDOW_MS = 10 * 60 * 1000;
export const STORAGE_MAX_MISSES_PER_WINDOW = 60;
const MAX_TRACKED_IPS = 10_000;

type MissWindow = { startedAt: number; misses: number };

const windows = new Map<string, MissWindow>();

const currentWindow = (ip: string, now: number): MissWindow | undefined => {
    const window = windows.get(ip);
    if (window && now - window.startedAt >= STORAGE_MISS_WINDOW_MS) {
        windows.delete(ip);
        return undefined;
    }
    return window;
};

// Seconds until this IP may fetch again, or 0 when it isn't blocked.
export const storageBlockedForSeconds = (ip: string, now: number = Date.now()): number => {
    const window = currentWindow(ip, now);
    if (!window || window.misses < STORAGE_MAX_MISSES_PER_WINDOW) {
        return 0;
    }
    return Math.ceil((window.startedAt + STORAGE_MISS_WINDOW_MS - now) / 1000);
};

export const recordStorageMiss = (ip: string, now: number = Date.now()): void => {
    const window = currentWindow(ip, now);
    if (window) {
        window.misses += 1;
        return;
    }
    if (windows.size >= MAX_TRACKED_IPS) {
        for (const [key, value] of windows) {
            if (now - value.startedAt >= STORAGE_MISS_WINDOW_MS) windows.delete(key);
        }
        // Still full of live windows: drop the oldest rather than grow without bound.
        if (windows.size >= MAX_TRACKED_IPS) {
            const oldest = windows.keys().next().value;
            if (oldest !== undefined) windows.delete(oldest);
        }
    }
    windows.set(ip, { startedAt: now, misses: 1 });
};

// MinIO's "no such object" errors, as opposed to MinIO being down or misconfigured.
export const isMissingObjectError = (err: unknown): boolean => {
    const code = (err as { code?: string } | null)?.code;
    return code === "NoSuchKey" || code === "NotFound";
};

// For tests only.
export const resetStorageMissLimiter = (): void => windows.clear();
