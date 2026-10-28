// Private files (verification attachments first) through a signed, short-lived link: ?t=<token>
// from privateMediaUrl (lib/media/private-media-token.ts). The server signs a link only for a
// viewer it has already checked, so this route checks the token, nothing else. The file is
// streamed from the private bucket, which has no public policy and is never behind /storage.
//
// Images that browsers render safely open inline; anything else downloads (Tim, 2026-10-28), as a
// PDF or as plain bytes. nosniff and a sandbox CSP stop a stored file from running as a page.
// A bad or expired token is a 404 and counts towards the client IP's misses, like a missing
// /storage object (lib/storage/miss-limiter.ts).

import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { verifyPrivateMediaToken } from "@/lib/media/private-media-token";
import { getPrivateObjectStream, statPrivateObject } from "@/lib/data/storage";
import { getClientIp } from "@/lib/utils/client-ip";
import { isMissingObjectError, recordStorageMiss, storageBlockedForSeconds } from "@/lib/storage/miss-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INLINE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const DOWNLOAD_TYPES = new Set(["application/pdf"]);

// RFC 6266 filename*, plus a plain ASCII fallback with anything unusual replaced.
const contentDisposition = (name: string | undefined): string => {
    const fallback = (name || "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "file";
    const encoded = encodeURIComponent(name || "file").slice(0, 300);
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

const notFound = (clientIp: string | null) => {
    if (clientIp) recordStorageMiss(clientIp);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
};

export async function GET(req: NextRequest) {
    const clientIp = getClientIp(req.headers);
    if (clientIp) {
        const blockedForSeconds = storageBlockedForSeconds(clientIp);
        if (blockedForSeconds > 0) {
            return NextResponse.json(
                { error: "Too many requests" },
                { status: 429, headers: { "Retry-After": String(blockedForSeconds) } },
            );
        }
    }

    const token = req.nextUrl.searchParams.get("t");
    const payload = token ? await verifyPrivateMediaToken(token) : null;
    if (!payload) {
        return notFound(clientIp);
    }

    try {
        const { size, contentType } = await statPrivateObject(payload.key);
        const inline = INLINE_IMAGE_TYPES.has(contentType);
        const servedType = inline || DOWNLOAD_TYPES.has(contentType) ? contentType : "application/octet-stream";
        const stream = await getPrivateObjectStream(payload.key);
        return new NextResponse(Readable.toWeb(stream as Readable) as ReadableStream, {
            status: 200,
            headers: {
                "Content-Type": servedType,
                "Content-Length": String(size),
                "Content-Disposition": inline ? "inline" : contentDisposition(payload.name),
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "sandbox",
                "Cache-Control": "private, max-age=300",
            },
        });
    } catch (err) {
        if (isMissingObjectError(err)) {
            return notFound(clientIp);
        }
        // The key isn't logged: it's what the token protects.
        console.error("[private media] fetch failed", { err });
        return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
    }
}
