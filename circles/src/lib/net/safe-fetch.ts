// safe-fetch.ts - outbound HTTP(S) fetches of user-supplied URLs, hardened against SSRF.
//
// Every hop (the first request and each redirect) is checked the same way: http/https only,
// port 80 or 443, no credentials in the URL, and the host must resolve only to public unicast
// addresses. The request then connects to the validated IP itself (Host header and TLS SNI keep
// the original hostname), so a second DNS answer can't swap in an internal address between the
// check and the connection (DNS rebinding). Any failure returns null; callers get no reason, so
// the fetch can't be used to probe what is reachable from the server.
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export type SafeFetchResult = {
    url: string; // final URL after redirects
    status: number;
    headers: Record<string, string>; // lower-cased names
    body: string;
};

export type SafeFetchOptions = {
    timeoutMs?: number; // one deadline for the whole fetch: every hop, headers and body
    maxBytes?: number;
    maxRedirects?: number;
    headers?: Record<string, string>;
};

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const ALLOWED_PORTS = new Set([80, 443]);

// --- Address classification ---

const parseIPv4 = (ip: string): number[] | null => {
    if (!net.isIPv4(ip)) return null;
    return ip.split(".").map(Number);
};

// 16 bytes, or null if not a valid IPv6 literal. Accepts a trailing dotted quad (::ffff:1.2.3.4).
const parseIPv6 = (ip: string): number[] | null => {
    if (!net.isIPv6(ip)) return null;
    let text = ip;
    const tail: number[] = [];
    const lastColon = text.lastIndexOf(":");
    const maybeV4 = text.slice(lastColon + 1);
    if (maybeV4.includes(".")) {
        const v4 = parseIPv4(maybeV4);
        if (!v4) return null;
        tail.push(...v4);
        text = text.slice(0, lastColon + 1) + "0:0"; // placeholder groups, replaced below
    }
    const [head, rest] = text.includes("::") ? text.split("::") : [text, undefined];
    const headGroups = head ? head.split(":") : [];
    const restGroups = rest !== undefined && rest !== "" ? rest.split(":") : [];
    const missing = 8 - headGroups.length - restGroups.length;
    if (missing < 0 || (rest === undefined && missing !== 0)) return null;
    const groups = [...headGroups, ...Array(missing).fill("0"), ...restGroups].map((g) => parseInt(g, 16));
    const bytes = groups.flatMap((g) => [g >> 8, g & 0xff]);
    if (tail.length) bytes.splice(12, 4, ...tail);
    return bytes;
};

const inV4 = (b: number[], prefix: [number, number, number, number], bits: number): boolean => {
    const addr = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    const net_ = ((prefix[0] << 24) | (prefix[1] << 16) | (prefix[2] << 8) | prefix[3]) >>> 0;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (addr & mask) === (net_ & mask);
};

// Non-public IPv4 ranges (IANA special-purpose registry, plus multicast and reserved).
const BLOCKED_V4: [[number, number, number, number], number][] = [
    [[0, 0, 0, 0], 8], // "this network", incl. 0.0.0.0
    [[10, 0, 0, 0], 8], // private
    [[100, 64, 0, 0], 10], // CGNAT
    [[127, 0, 0, 0], 8], // loopback
    [[169, 254, 0, 0], 16], // link-local (incl. cloud metadata 169.254.169.254)
    [[172, 16, 0, 0], 12], // private
    [[192, 0, 0, 0], 24], // IETF protocol assignments
    [[192, 0, 2, 0], 24], // documentation
    [[192, 88, 99, 0], 24], // 6to4 relay anycast
    [[192, 168, 0, 0], 16], // private
    [[198, 18, 0, 0], 15], // benchmarking
    [[198, 51, 100, 0], 24], // documentation
    [[203, 0, 113, 0], 24], // documentation
    [[224, 0, 0, 0], 4], // multicast
    [[240, 0, 0, 0], 4], // reserved, incl. 255.255.255.255 broadcast
];

const isPublicV4 = (b: number[]): boolean => !BLOCKED_V4.some(([prefix, bits]) => inV4(b, prefix, bits));

/**
 * True only for a globally routable unicast address. IPv6 is allow-listed to 2000::/3 (global
 * unicast), which excludes ::, ::1, fe80::/10, fc00::/7 and ff00::/8; forms that embed an IPv4
 * address (IPv4-mapped ::ffff:0:0/96, NAT64 64:ff9b::/96, 6to4 2002::/16) are judged by the
 * embedded IPv4 address. Anything that isn't an IP literal is rejected.
 */
export const isPublicAddress = (ip: string): boolean => {
    const v4 = parseIPv4(ip);
    if (v4) return isPublicV4(v4);

    const b = parseIPv6(ip.includes("%") ? "" : ip); // zone ids only appear on link-local
    if (!b) return false;

    const isZero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
    // IPv4-mapped ::ffff:a.b.c.d
    if (isZero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPublicV4(b.slice(12));
    // NAT64 64:ff9b::a.b.c.d
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && isZero(4, 12)) {
        return isPublicV4(b.slice(12));
    }
    // 6to4 2002:aabb:ccdd::/48
    if (b[0] === 0x20 && b[1] === 0x02) return isPublicV4(b.slice(2, 6));

    if ((b[0] & 0xe0) !== 0x20) return false; // not 2000::/3
    if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false; // 2001:db8::/32 docs
    if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return false; // 2001::/32 Teredo
    return true;
};

// --- URL / host checks ---

const stripBrackets = (host: string) => (host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host);

/** Scheme, port and credential checks for one hop. Returns the parsed URL or null. */
export const checkUrlShape = (raw: string, base?: string): URL | null => {
    let url: URL;
    try {
        url = new URL(raw, base);
    } catch {
        return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    if (!ALLOWED_PORTS.has(port)) return null;
    return url;
};

/** Resolves the host and returns one address to connect to, or null if any answer isn't public. */
export const resolvePublicAddress = async (hostname: string): Promise<{ address: string; family: 4 | 6 } | null> => {
    const host = stripBrackets(hostname);
    if (net.isIP(host)) {
        return isPublicAddress(host) ? { address: host, family: net.isIPv6(host) ? 6 : 4 } : null;
    }
    let answers: { address: string; family: number }[];
    try {
        answers = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
        return null;
    }
    // Every answer must be public: a mixed answer set is how rebinding services hand out both.
    if (answers.length === 0 || !answers.every((a) => isPublicAddress(a.address))) return null;
    return { address: answers[0].address, family: answers[0].family === 6 ? 6 : 4 };
};

// --- Fetch ---

type HopResponse = { status: number; headers: http.IncomingHttpHeaders; res: http.IncomingMessage };

const requestPinned = (url: URL, address: string, headers: Record<string, string>, signal: AbortSignal) =>
    new Promise<HopResponse>((resolve, reject) => {
        const isHttps = url.protocol === "https:";
        const hostname = stripBrackets(url.hostname);
        const options: https.RequestOptions = {
            method: "GET",
            host: address, // the validated IP: no second DNS lookup
            port: url.port ? Number(url.port) : isHttps ? 443 : 80,
            path: `${url.pathname}${url.search}`,
            headers: { ...headers, host: url.host },
            signal,
            agent: false,
        };
        // Certificate is still verified against the hostname, not the IP.
        if (isHttps && !net.isIP(hostname)) options.servername = hostname;
        const req = (isHttps ? https : http).request(options, (res) => {
            resolve({ status: res.statusCode ?? 0, headers: res.headers, res });
        });
        req.on("error", reject);
        req.end();
    });

const readBody = (res: http.IncomingMessage, maxBytes: number) =>
    new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
                res.destroy(new Error("response too large"));
                return;
            }
            chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
        res.on("close", () => {
            if (!res.complete) reject(new Error("response aborted"));
        });
    });

const decode = (body: Buffer, contentType: string): string => {
    const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
    try {
        return new TextDecoder(charset || "utf-8").decode(body);
    } catch {
        return new TextDecoder("utf-8").decode(body);
    }
};

/**
 * GETs a user-supplied URL that must serve text/html, following at most `maxRedirects` redirects
 * and re-checking every hop. Returns null on any rejection or failure, without saying why.
 */
export const safeFetchHtml = async (rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult | null> => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const headers = {
        ...options.headers,
        accept: "text/html",
        "accept-encoding": "identity", // no decompression step, so maxBytes is the real size
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let url = checkUrlShape(rawUrl);
        for (let hop = 0; url; hop++) {
            const target = await resolvePublicAddress(url.hostname);
            if (!target || controller.signal.aborted) return null;

            const { status, headers: resHeaders, res } = await requestPinned(
                url,
                target.address,
                headers,
                controller.signal,
            );

            if (status >= 300 && status < 400) {
                res.destroy();
                const location = resHeaders.location;
                if (!location || hop >= maxRedirects) return null;
                url = checkUrlShape(location, url.toString());
                continue;
            }

            const contentType = String(resHeaders["content-type"] ?? "");
            const declaredLength = Number(resHeaders["content-length"] ?? 0);
            if (status < 200 || status >= 300 || !/^text\/html\b/i.test(contentType) || declaredLength > maxBytes) {
                res.destroy();
                return null;
            }

            const body = await readBody(res, maxBytes);
            const flatHeaders: Record<string, string> = {};
            for (const [name, value] of Object.entries(resHeaders)) {
                if (value !== undefined) flatHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
            }
            return { url: url.toString(), status, headers: flatHeaders, body: decode(body, contentType) };
        }
        return null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
        controller.abort(); // tear down any socket still open
    }
};
