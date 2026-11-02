// Run: bun test src/lib/media/private-media.test.ts
// Signed private-media links: the token, savePrivateFile, and /api/private-media with the private
// bucket mocked (nothing is read from or written to storage).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { randomBytes } from "crypto";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";

// A throwaway key for this run only.
process.env.JWT_SECRET = randomBytes(32).toString("hex");

type StoredObject = { buffer: Buffer; contentType: string };
const objects = new Map<string, StoredObject>();

mock.module("minio", () => ({
    Client: class {
        bucketExists = async () => true;
        makeBucket = async () => undefined;
        setBucketPolicy = async () => undefined;
        putObject = async (_bucket: string, key: string, buffer: Buffer, _size: number, meta: Record<string, string>) => {
            objects.set(key, { buffer, contentType: meta["Content-Type"] });
        };
        statObject = async (_bucket: string, key: string) => {
            const object = objects.get(key);
            if (!object) throw Object.assign(new Error("missing"), { code: "NotFound" });
            return { size: object.buffer.length, metaData: { "content-type": object.contentType } };
        };
        getObject = async (_bucket: string, key: string) => {
            const { Readable } = await import("node:stream");
            return Readable.from([objects.get(key)!.buffer]);
        };
    },
}));

const { signPrivateMediaToken, verifyPrivateMediaToken, privateMediaUrl, VERIFICATION_MEDIA_TTL_SECONDS } =
    await import("./private-media-token");
const { generateUserToken, verifyUserToken } = await import("@/lib/auth/jwt");
const { signAudioToken } = await import("@/lib/audio/audio-token");
const { savePrivateFile } = await import("@/lib/data/storage");
const { GET } = await import("@/app/api/private-media/route");
const { resetStorageMissLimiter } = await import("@/lib/storage/miss-limiter");

const KEY = "verification/665f00000000000000000001/abc.pdf";

// This bun's expect() types have no .rejects.
const throws = async (promise: Promise<unknown>): Promise<boolean> => {
    try {
        await promise;
        return false;
    } catch {
        return true;
    }
};

describe("private media token", () => {
    test("round trip", async () => {
        const token = await signPrivateMediaToken({ key: KEY, name: "passport.pdf" }, 60);
        expect(await verifyPrivateMediaToken(token)).toEqual({ key: KEY, name: "passport.pdf" });
    });

    test("expired, tampered or foreign tokens are refused", async () => {
        const expired = await signPrivateMediaToken({ key: KEY }, -10);
        expect(await verifyPrivateMediaToken(expired)).toBeNull();

        const token = await signPrivateMediaToken({ key: KEY }, 60);
        expect(await verifyPrivateMediaToken(token.slice(0, -2) + "xx")).toBeNull();

        // Signed with JWT_SECRET itself (sessions, audio): never a media token.
        expect(await verifyPrivateMediaToken(await generateUserToken("did:test:someone"))).toBeNull();
        expect(await verifyPrivateMediaToken(await signAudioToken({ trackId: "t", previewKey: KEY }))).toBeNull();
        const sameAudienceWrongKey = await new SignJWT({ key: KEY })
            .setProtectedHeader({ alg: "HS256" })
            .setAudience("peerify-private-media")
            .setExpirationTime("1h")
            .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
        expect(await verifyPrivateMediaToken(sameAudienceWrongKey)).toBeNull();
    });

    test("a media token is not a session", async () => {
        const token = await signPrivateMediaToken({ key: KEY }, 60);
        expect(await throws(verifyUserToken(token))).toBe(true);
    });

    test("only allowed key prefixes are signed", async () => {
        expect(await throws(signPrivateMediaToken({ key: "audio/x/original.wav" }, 60))).toBe(true);
        expect(await throws(signPrivateMediaToken({ key: "verification/../audio/x" }, 60))).toBe(true);
    });

    test("verification links last 15 minutes", () => {
        expect(VERIFICATION_MEDIA_TTL_SECONDS).toBe(15 * 60);
    });
});

describe("savePrivateFile", () => {
    test("random key in the folder, no URL", async () => {
        const info = await savePrivateFile(new File(["%PDF-1.4 test"], "ID card.pdf", { type: "application/pdf" }), "verification/abc123");

        expect(/^verification\/abc123\/[0-9a-f]{32}\.pdf$/.test(info.key)).toBe(true);
        expect(info.originalName).toBe("ID card.pdf");
        expect("url" in info).toBe(false);
        expect(objects.has(info.key)).toBe(true);
    });

    test("odd extensions and folders are refused or dropped", async () => {
        const info = await savePrivateFile(new File(["x"], "a.<script>", { type: "text/plain" }), "verification/abc123");
        expect(/^verification\/abc123\/[0-9a-f]{32}$/.test(info.key)).toBe(true);
        expect(await throws(savePrivateFile(new File(["x"], "a.txt"), "../etc"))).toBe(true);
        expect(await throws(savePrivateFile(new File(["x"], "a.txt"), "verification"))).toBe(true);
    });
});

describe("/api/private-media", () => {
    beforeEach(() => {
        resetStorageMissLimiter();
        objects.clear();
        objects.set("verification/c/photo.png", { buffer: Buffer.from("png-bytes"), contentType: "image/png" });
        objects.set("verification/c/doc.pdf", { buffer: Buffer.from("pdf-bytes"), contentType: "application/pdf" });
        objects.set("verification/c/page.html", { buffer: Buffer.from("<script>"), contentType: "text/html" });
    });

    const get = async (url: string, ip = "9.9.9.9") =>
        GET(new NextRequest(`http://localhost${url}`, { headers: { "x-real-ip": ip } }));

    test("an image opens inline", async () => {
        const res = await get(await privateMediaUrl({ key: "verification/c/photo.png" }, 60));
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("image/png");
        expect(res.headers.get("Content-Disposition")).toBe("inline");
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(await res.text()).toBe("png-bytes");
    });

    test("a PDF downloads under its name; anything else downloads as bytes", async () => {
        const pdf = await get(await privateMediaUrl({ key: "verification/c/doc.pdf", name: "My ID.pdf" }, 60));
        expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
        expect(pdf.headers.get("Content-Disposition")).toContain("attachment");
        expect(pdf.headers.get("Content-Disposition")).toContain("filename*=UTF-8''My%20ID.pdf");

        const html = await get(await privateMediaUrl({ key: "verification/c/page.html" }, 60));
        expect(html.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(html.headers.get("Content-Disposition")).toContain("attachment");
        expect(html.headers.get("Content-Security-Policy")).toBe("sandbox");
    });

    test("no token, a bad token or a missing object: 404", async () => {
        expect((await get("/api/private-media")).status).toBe(404);
        expect((await get("/api/private-media?t=nope")).status).toBe(404);
        expect((await get(await privateMediaUrl({ key: "verification/c/gone.png" }, 60))).status).toBe(404);
    });
});
