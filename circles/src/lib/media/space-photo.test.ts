// Run: bun test src/lib/media/space-photo.test.ts
// Space photos behind /api/space-photo: the address helpers, and the route with the session, the
// view check and the private bucket mocked (nothing is read from or written to storage).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const objects = new Map<string, { buffer: Buffer; contentType: string }>();
let viewerDid: string | undefined;
let allowed = true;
const viewChecks: unknown[][] = [];

mock.module("@/lib/auth/auth", () => ({ getAuthenticatedUserDid: async () => viewerDid }));
mock.module("@/lib/data/space", () => ({
    canViewSpacePhoto: async (...args: unknown[]) => {
        viewChecks.push(args);
        return allowed;
    },
}));
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

const { parseSpacePhotoUrl, spacePhotoKey, spacePhotoRefFromKey, spacePhotoUrl } = await import("./space-photo");
const { GET } = await import("@/app/api/space-photo/[spaceId]/[file]/route");
const { resetStorageMissLimiter } = await import("@/lib/storage/miss-limiter");

const SPACE = "665f00000000000000000009";
const FILE = "0123456789abcdef0123456789abcdef.webp";
const REF = { spaceId: SPACE, file: FILE };

const get = (spaceId: string, file: string, ip = "203.0.113.7") =>
    GET(new NextRequest(`http://localhost/api/space-photo/${spaceId}/${file}`, { headers: { "x-real-ip": ip } }), {
        params: Promise.resolve({ spaceId, file }),
    });

describe("space photo addresses", () => {
    test("url, key and parse agree; anything else is refused", () => {
        expect(spacePhotoUrl(REF)).toBe(`/api/space-photo/${SPACE}/${FILE}`);
        expect(spacePhotoKey(REF)).toBe(`space-photos/${SPACE}/${FILE}`);
        expect(parseSpacePhotoUrl(spacePhotoUrl(REF))).toEqual(REF);
        expect(spacePhotoRefFromKey(SPACE, spacePhotoKey(REF))).toEqual(REF);
        expect(parseSpacePhotoUrl(`/api/offer-photo/${SPACE}/${FILE}`)).toBeNull();
        expect(parseSpacePhotoUrl(`/api/space-photo/${SPACE}/../x.jpg`)).toBeNull();
        expect(spacePhotoRefFromKey(SPACE, `space-photos/665f0000000000000000000a/${FILE}`)).toBeNull();
    });
});

describe("/api/space-photo", () => {
    beforeEach(() => {
        objects.clear();
        resetStorageMissLimiter();
        viewChecks.length = 0;
        viewerDid = "did:test:member";
        allowed = true;
        objects.set(spacePhotoKey(REF), { buffer: Buffer.from("webp bytes"), contentType: "image/webp" });
    });

    test("an allowed viewer gets the photo inline; the check gets the viewer and the address", async () => {
        const res = await get(SPACE, FILE);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/webp");
        expect(res.headers.get("content-security-policy")).toBe("sandbox");
        expect(await res.text()).toBe("webp bytes");
        expect(viewChecks).toEqual([["did:test:member", SPACE, spacePhotoUrl(REF)]]);
    });

    test("signed out: 404 without asking, not counted as a miss", async () => {
        viewerDid = undefined;
        for (let i = 0; i < 70; i++) expect((await get(SPACE, FILE)).status).toBe(404);
        expect(viewChecks).toHaveLength(0);
        viewerDid = "did:test:member";
        expect((await get(SPACE, FILE)).status).toBe(200);
    });

    test("refused by the view check, or not an image: 404", async () => {
        allowed = false;
        expect((await get(SPACE, FILE)).status).toBe(404);
        allowed = true;
        objects.set(spacePhotoKey(REF), { buffer: Buffer.from("<svg/>"), contentType: "image/svg+xml" });
        expect((await get(SPACE, FILE)).status).toBe(404);
    });
});
