// Space photos (lib/media/space-photo.ts): served from the private bucket only to a viewer
// canViewSpacePhoto allows (the owner, platform admins, or any signed-in person while the space is
// on the map), and only while the space still has the photo. A stable address, like offer photos
// (/api/offer-photo), so the space form keeps photos however long it stays open. Images only,
// inline, with nosniff and a sandbox CSP.
//
// Signed out: 404, not counted as a miss. Anything else refused is a 404 that counts towards the
// client IP's misses, like a missing /storage object (lib/storage/miss-limiter.ts).

import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { canViewSpacePhoto } from "@/lib/data/space";
import { getPrivateObjectStream, statPrivateObject } from "@/lib/data/storage";
import { isSpacePhotoRef, spacePhotoKey, spacePhotoUrl } from "@/lib/media/space-photo";
import { getClientIp } from "@/lib/utils/client-ip";
import { isMissingObjectError, recordStorageMiss, storageBlockedForSeconds } from "@/lib/storage/miss-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const notFound = (clientIp: string | null, countMiss: boolean) => {
    if (clientIp && countMiss) recordStorageMiss(clientIp);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
};

export async function GET(req: NextRequest, context: { params: Promise<{ spaceId: string; file: string }> }) {
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

    const viewerDid = await getAuthenticatedUserDid().catch(() => undefined);
    if (!viewerDid) {
        return notFound(clientIp, false);
    }

    const { spaceId, file } = await context.params;
    if (!isSpacePhotoRef(spaceId, file)) {
        return notFound(clientIp, true);
    }
    const ref = { spaceId, file };
    if (!(await canViewSpacePhoto(viewerDid, spaceId, spacePhotoUrl(ref)))) {
        return notFound(clientIp, true);
    }

    try {
        const key = spacePhotoKey(ref);
        const { size, contentType } = await statPrivateObject(key);
        if (!IMAGE_TYPES.has(contentType)) {
            return notFound(clientIp, true);
        }
        const stream = await getPrivateObjectStream(key);
        return new NextResponse(Readable.toWeb(stream as Readable) as ReadableStream, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Length": String(size),
                "Content-Disposition": "inline",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "sandbox",
                "Cache-Control": "private, max-age=300",
            },
        });
    } catch (err) {
        if (isMissingObjectError(err)) {
            return notFound(clientIp, true);
        }
        console.error("[space photo] fetch failed", { err });
        return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
    }
}
