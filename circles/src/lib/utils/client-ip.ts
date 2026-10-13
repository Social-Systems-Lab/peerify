// The client address as seen by our own nginx, which overwrites X-Real-IP with $remote_addr on
// every request (the app listens on 127.0.0.1 only, so nginx is the only way in). X-Forwarded-For
// is deliberately not used: without our nginx in front it is entirely client-controlled. Returns
// null when X-Real-IP is missing (local dev); callers then share one "unknown" bucket, which is
// stricter, never looser.
export const getClientIp = (headers: Pick<Headers, "get">): string | null => headers.get("x-real-ip")?.trim() || null;
