// Run: bun test src/lib/media/offer-photo.test.ts
// Offer photos behind /api/offer-photo: the address helpers, and the route with the session, the
// circle lookup and the private bucket mocked (nothing is read from or written to storage).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

type StoredObject = { buffer: Buffer; contentType: string };
const objects = new Map<string, StoredObject>();
let viewerDid: string | undefined;
let circlePhotos = new Set<string>();

mock.module("@/lib/auth/auth", () => ({ getAuthenticatedUserDid: async () => viewerDid }));
mock.module("@/lib/data/circle", () => ({ circleHasOfferPhoto: async (_id: string, url: string) => circlePhotos.has(url) }));
mock.module("@/lib/data/storage", () => ({
    statPrivateObject: async (key: string) => {
        const object = objects.get(key);
        if (!object) throw Object.assign(new Error("missing"), { code: "NotFound" });
        return { size: object.buffer.length, contentType: object.contentType };
    },
    getPrivateObjectStream: async (key: string) => {
        const { Readable } = await import("node:stream");
        return Readable.from([objects.get(key)!.buffer]);
    },
}));

const { isOfferPhotoRef, isPhotoFileName, offerPhotoKey, offerPhotoRefFromKey, offerPhotoUrl, parseOfferPhotoUrl } = await import(
    "./offer-photo"
);
const { sanitizeUpload } = await import("./sanitize-image");
const sharp = (await import("sharp")).default;
const { GET } = await import("@/app/api/offer-photo/[circleId]/[file]/route");
const { resetStorageMissLimiter } = await import("@/lib/storage/miss-limiter");

const CIRCLE = "665f00000000000000000001";
const FILE = "0123456789abcdef0123456789abcdef.jpg";
const REF = { circleId: CIRCLE, file: FILE };

const get = (circleId: string, file: string, ip = "203.0.113.7") =>
    GET(new NextRequest(`http://localhost/api/offer-photo/${circleId}/${file}`, { headers: { "x-real-ip": ip } }), {
        params: Promise.resolve({ circleId, file }),
    });

describe("offer photo addresses", () => {
    test("url, key and parse agree", () => {
        expect(offerPhotoUrl(REF)).toBe(`/api/offer-photo/${CIRCLE}/${FILE}`);
        expect(offerPhotoKey(REF)).toBe(`offer-photos/${CIRCLE}/${FILE}`);
        expect(parseOfferPhotoUrl(offerPhotoUrl(REF))).toEqual(REF);
        expect(offerPhotoRefFromKey(CIRCLE, `offer-photos/${CIRCLE}/${FILE}`)).toEqual(REF);
    });

    test("anything else is refused", () => {
        expect(parseOfferPhotoUrl(`/storage/${CIRCLE}/offer-photo1.png`)).toBeNull();
        expect(parseOfferPhotoUrl(`/api/offer-photo/${CIRCLE}/${FILE}/extra`)).toBeNull();
        expect(parseOfferPhotoUrl(`/api/offer-photo/${CIRCLE}/../audio/x.jpg`)).toBeNull();
        expect(isOfferPhotoRef(CIRCLE, "0123456789abcdef0123456789abcdef.svg")).toBe(false);
        expect(isOfferPhotoRef("not-a-circle", FILE)).toBe(false);
        expect(offerPhotoRefFromKey(CIRCLE, `offer-photos/665f00000000000000000002/${FILE}`)).toBeNull();
        expect(offerPhotoRefFromKey(CIRCLE, `offer-photos/${CIRCLE}/0123456789abcdef0123456789abcdef.pdf`)).toBeNull();
    });
});

describe("/api/offer-photo", () => {
    beforeEach(() => {
        objects.clear();
        resetStorageMissLimiter();
        viewerDid = "did:test:member";
        circlePhotos = new Set([offerPhotoUrl(REF)]);
        objects.set(offerPhotoKey(REF), { buffer: Buffer.from("jpeg bytes"), contentType: "image/jpeg" });
    });

    test("a signed-in viewer gets the photo inline", async () => {
        const res = await get(CIRCLE, FILE);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/jpeg");
        expect(res.headers.get("content-disposition")).toBe("inline");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("cache-control")).toBe("private, max-age=300");
        expect(await res.text()).toBe("jpeg bytes");
    });

    test("signed out: 404, and not counted as a miss", async () => {
        viewerDid = undefined;
        for (let i = 0; i < 80; i++) expect((await get(CIRCLE, FILE)).status).toBe(404);
        viewerDid = "did:test:member";
        expect((await get(CIRCLE, FILE)).status).toBe(200);
    });

    test("a photo the circle no longer has is a 404", async () => {
        circlePhotos = new Set();
        expect((await get(CIRCLE, FILE)).status).toBe(404);
    });

    test("bad names and missing objects are 404s that count towards the limit", async () => {
        expect((await get(CIRCLE, "nope.jpg")).status).toBe(404);
        objects.clear();
        for (let i = 0; i < 60; i++) await get(CIRCLE, FILE, "198.51.100.9");
        objects.set(offerPhotoKey(REF), { buffer: Buffer.from("jpeg bytes"), contentType: "image/jpeg" });
        expect((await get(CIRCLE, FILE, "198.51.100.9")).status).toBe(429);
    });

    test("a stored object that isn't an image is not served", async () => {
        objects.set(offerPhotoKey(REF), { buffer: Buffer.from("<html>"), contentType: "text/html" });
        expect((await get(CIRCLE, FILE)).status).toBe(404);
        objects.set(offerPhotoKey(REF), { buffer: Buffer.from("%PDF-1.4"), contentType: "application/pdf" });
        expect((await get(CIRCLE, FILE)).status).toBe(404);
    });

    test("PNG is served as PNG", async () => {
        const png = { circleId: CIRCLE, file: "0123456789abcdef0123456789abcdef.png" };
        circlePhotos = new Set([offerPhotoUrl(png)]);
        objects.set(offerPhotoKey(png), { buffer: Buffer.from("png bytes"), contentType: "image/png" });
        const res = await get(CIRCLE, png.file);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
    });
});

describe("AVIF offer photos", () => {
    const AVIF = { circleId: CIRCLE, file: "0123456789abcdef0123456789abcdef.avif" };
    let avifBytes: Buffer;

    beforeEach(async () => {
        objects.clear();
        resetStorageMissLimiter();
        avifBytes ??= await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 9, g: 99, b: 199 } } })
            .avif()
            .toBuffer();
        circlePhotos = new Set([offerPhotoUrl(AVIF)]);
        objects.set(offerPhotoKey(AVIF), { buffer: avifBytes, contentType: "image/avif" });
    });

    test("an .avif name is an offer photo (and a photo file name for spaces too)", () => {
        expect(isOfferPhotoRef(CIRCLE, AVIF.file)).toBe(true);
        expect(parseOfferPhotoUrl(offerPhotoUrl(AVIF))).toEqual(AVIF);
        expect(offerPhotoRefFromKey(CIRCLE, offerPhotoKey(AVIF))).toEqual(AVIF);
        expect(isPhotoFileName(AVIF.file)).toBe(true);
    });

    test("signed in: served byte for byte as image/avif", async () => {
        viewerDid = "did:test:member";
        const res = await get(CIRCLE, AVIF.file);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/avif");
        expect(res.headers.get("content-disposition")).toBe("inline");
        expect(Buffer.from(await res.arrayBuffer()).equals(avifBytes)).toBe(true);
    });

    test("signed out: refused", async () => {
        viewerDid = undefined;
        expect((await get(CIRCLE, AVIF.file)).status).toBe(404);
    });

    test("a new AVIF upload is kept as AVIF (what savePrivateFile stores)", async () => {
        const out = await sanitizeUpload(avifBytes, "image/avif", "room.avif");
        expect(out.contentType).toBe("image/avif");
        expect(out.extension).toBe(".avif");
        expect((await sharp(out.buffer).metadata()).format).toBe("heif");
    });
});
