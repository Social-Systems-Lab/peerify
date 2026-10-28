// Offer photos (lib/media/offer-photo.ts): served from the private bucket to signed-in viewers
// only, and only while the circle still has the photo on one of its offerings. A stable address
// rather than a signed link, so the offer editor can send photos back unchanged however long it
// stays open (Tim, 2026-10-28). Images only, inline, with nosniff and a sandbox CSP.
//
// Signed out: 404, not counted as a miss (a session can run out with a page of photos open). A bad
// name, a photo the circle doesn't have or a missing object is a 404 that counts towards the
// client IP's misses, like a missing /storage object (lib/storage/miss-limiter.ts).

import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { circleHasOfferPhoto } from "@/lib/data/circle";
import { getPrivateObjectStream, statPrivateObject } from "@/lib/data/storage";
import { isOfferPhotoRef, offerPhotoKey, offerPhotoUrl } from "@/lib/media/offer-photo";
import { getClientIp } from "@/lib/utils/client-ip";
import { isMissingObjectError, recordStorageMiss, storageBlockedForSeconds } from "@/lib/storage/miss-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const notFound = (clientIp: string | null, countMiss: boolean) => {
    if (clientIp && countMiss) recordStorageMiss(clientIp);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
};

export async function GET(req: NextRequest, context: { params: Promise<{ circleId: string; file: string }> }) {
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

    const { circleId, file } = await context.params;
    if (!isOfferPhotoRef(circleId, file)) {
        return notFound(clientIp, true);
    }
    const ref = { circleId, file };
    if (!(await circleHasOfferPhoto(circleId, offerPhotoUrl(ref)))) {
        return notFound(clientIp, true);
    }

    try {
        const key = offerPhotoKey(ref);
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
        console.error("[offer photo] fetch failed", { err });
        return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
    }
}
