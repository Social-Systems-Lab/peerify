// The origin the visitor actually used (e.g. https://staging.peerify.one), for absolute URLs the
// app hands back to the browser: middleware redirects and the ICS feeds' event links.
//
// request.url can't be used for this: behind nginx, the Next standalone server builds it from its
// own listen address (HOSTNAME/PORT, so https://localhost:3000/...), not from the request. nginx
// passes the visitor's host as Host and the scheme as X-Forwarded-Proto on every box, so those
// follow whichever domain the visitor came in on — the old box, Cleura, and both names during the
// cutover — with no per-box setting. The Host is only used when it is on the allowlist below;
// anything else falls back to CIRCLES_URL (the configured site URL used for emails), then to the
// request's own origin.
// Shared by the middleware redirects and the ICS feeds' links.
//
// Kept free of Node imports: middleware.ts runs it in the edge runtime.

type HeaderSource = { get(name: string): string | null };

// hostname, optionally ":port"; no path, spaces or other characters.
const HOST_PATTERN = /^([a-z0-9.-]+)(?::\d{1,5})?$/i;
const PUBLIC_DOMAIN = "peerify.one";
const LOCAL_DEV_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

// Exactly peerify.one or a subdomain of it (staging, cleura-staging, ...), or localhost /
// 127.0.0.1 for local dev, each optionally with a port.
export function isAllowedPublicHost(host: string): boolean {
    const match = HOST_PATTERN.exec(host);
    if (!match) {
        return false;
    }
    const hostname = match[1].toLowerCase();
    return hostname === PUBLIC_DOMAIN || hostname.endsWith(`.${PUBLIC_DOMAIN}`) || LOCAL_DEV_HOSTNAMES.has(hostname);
}

export function getPublicOrigin(headers: HeaderSource, requestUrl: string): string {
    const host = headers.get("host")?.trim() ?? "";
    const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    if (host && isAllowedPublicHost(host)) {
        // Without X-Forwarded-Proto (a direct hit, e.g. local dev) the request's own scheme is right.
        const proto =
            forwardedProto === "https" || forwardedProto === "http"
                ? forwardedProto
                : new URL(requestUrl).protocol.replace(":", "");
        return `${proto}://${host}`;
    }

    const configured = process.env.CIRCLES_URL?.trim();
    if (configured) {
        try {
            return new URL(configured).origin;
        } catch {
            // fall through to the request's own origin
        }
    }

    return new URL(requestUrl).origin;
}

// An absolute URL on the public origin for a path taken from the app or from the request.
// Never new URL(path, origin): a path starting with "//" or "/\\" (e.g. https://peerify.one//evil.example/x)
// is read as another host. The origin is fixed first and the path set on its own, with any run of
// leading slashes/backslashes reduced to one "/".
export function buildPublicUrl(headers: HeaderSource, requestUrl: string, pathname: string, search = ""): URL {
    const url = new URL(getPublicOrigin(headers, requestUrl));
    url.pathname = "/" + pathname.replace(/^[\\/]+/, "");
    url.search = search;
    return url;
}

// Domain part of ICS event UIDs. Fixed rather than taken from the request, so an event keeps the
// same UID whichever domain the feed is fetched from (calendar apps match updates by UID).
export const ICS_UID_DOMAIN = "peerify.one";
