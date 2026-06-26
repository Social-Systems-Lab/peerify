// Peerify: signed, expiring audio stream for a track's MP3 derivative.
//
// The object key is carried inside a short-lived JWT (?t=...), so keys are never
// exposed in plain URLs and the link expires. The derivative is streamed from the
// PRIVATE bucket server-side; the original is never reachable here. HTTP Range is
// supported so native <audio> seeking works.

import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { verifyAudioToken } from "@/lib/audio/audio-token";
import { getPrivateObjectStream, statPrivateObject } from "@/lib/data/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPE = "audio/mpeg";

export async function GET(req: NextRequest) {
    const token = req.nextUrl.searchParams.get("t");
    if (!token) {
        return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    const payload = await verifyAudioToken(token);
    if (!payload) {
        return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const key = payload.previewKey;

    try {
        const { size } = await statPrivateObject(key);
        const rangeHeader = req.headers.get("range");

        const baseHeaders: Record<string, string> = {
            "Content-Type": CONTENT_TYPE,
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, no-store",
        };

        if (rangeHeader) {
            const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
            if (match) {
                const start = parseInt(match[1], 10);
                const end = match[2] ? parseInt(match[2], 10) : size - 1;

                if (Number.isNaN(start) || start >= size || end >= size || start > end) {
                    return new NextResponse(null, {
                        status: 416,
                        headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
                    });
                }

                const length = end - start + 1;
                const stream = await getPrivateObjectStream(key, start, length);
                return new NextResponse(Readable.toWeb(stream as Readable) as ReadableStream, {
                    status: 206,
                    headers: {
                        ...baseHeaders,
                        "Content-Range": `bytes ${start}-${end}/${size}`,
                        "Content-Length": String(length),
                    },
                });
            }
        }

        const stream = await getPrivateObjectStream(key);
        return new NextResponse(Readable.toWeb(stream as Readable) as ReadableStream, {
            status: 200,
            headers: { ...baseHeaders, "Content-Length": String(size) },
        });
    } catch (err) {
        console.error("[peerify audio stream] failed", { key, err });
        return NextResponse.json({ error: "Audio fetch failed" }, { status: 404 });
    }
}
