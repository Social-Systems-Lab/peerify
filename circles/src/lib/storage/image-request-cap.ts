// Per-IP cap on /_next/image requests for stored files (url=/storage/… or /uploads/…), checked in
// middleware.ts (Tim, 2026-10-28). The optimizer fetches the file internally with no headers, so
// the /storage route can't see who's asking and its miss limit (miss-limiter.ts) doesn't apply.
// Middleware sees the real request but not whether the file existed, so this caps volume instead:
// far above what a person browsing loads, far below what guessing old timestamp names needs.
//
// In memory, a fixed one-minute window per IP. Middleware runs in one sandbox per server process,
// and there's one PM2 process per environment, so that's one counter; a restart resets it. Pure
// (no Node APIs), so it runs in the middleware runtime.

export const IMAGE_REQUEST_WINDOW_MS = 60 * 1000;
export const IMAGE_REQUESTS_PER_WINDOW = 300;
const MAX_TRACKED_IPS = 10_000;

type RequestWindow = { startedAt: number; requests: number };

const windows = new Map<string, RequestWindow>();

// Whether /_next/image is being asked for one of our stored files.
export const isStoredFileImageRequest = (pathname: string, searchParams: URLSearchParams): boolean => {
    if (pathname !== "/_next/image") return false;
    const url = searchParams.get("url") ?? "";
    return url.startsWith("/storage/") || url.startsWith("/uploads/");
};

// Counts this request. Returns 0 when it may go through, otherwise the seconds until the IP's
// window ends.
export const takeImageRequest = (ip: string, now: number = Date.now()): number => {
    const window = windows.get(ip);
    if (window && now - window.startedAt < IMAGE_REQUEST_WINDOW_MS) {
        window.requests += 1;
        if (window.requests <= IMAGE_REQUESTS_PER_WINDOW) return 0;
        return Math.ceil((window.startedAt + IMAGE_REQUEST_WINDOW_MS - now) / 1000);
    }
    if (!window && windows.size >= MAX_TRACKED_IPS) {
        for (const [key, value] of windows) {
            if (now - value.startedAt >= IMAGE_REQUEST_WINDOW_MS) windows.delete(key);
        }
        if (windows.size >= MAX_TRACKED_IPS) {
            const oldest = windows.keys().next().value;
            if (oldest !== undefined) windows.delete(oldest);
        }
    }
    windows.set(ip, { startedAt: now, requests: 1 });
    return 0;
};

// For tests only.
export const resetImageRequestCap = (): void => windows.clear();
