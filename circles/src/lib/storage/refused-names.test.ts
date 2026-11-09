// Run: bun test src/lib/storage/refused-names.test.ts
// The names /storage and /uploads refuse, then both routes with MinIO mocked (nothing is read).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { STORAGE_MAX_MISSES_PER_WINDOW, resetStorageMissLimiter } from "./miss-limiter";
import { isRefusedPublicName } from "./refused-names";

const C = "665f00000000000000000001";

describe("isRefusedPublicName", () => {
    test("offer photos and verification attachments, old and new names, any case", () => {
        for (const name of [
            `${C}/offer-photo-0123456789abcdef0123456789abcdef.jpg`,
            `${C}/offer-photo1730000000000.png`,
            `${C}/Offer-Photo-1730000000000.JPG`,
            `${C}/verification-attachment1730000000000.pdf`,
            `${C}/verification-attachment-0123456789abcdef0123456789abcdef.png`,
            `${C}/VERIFICATION-ATTACHMENT1700.PDF`,
            `a/b/${C}/offer-photo-x.webp`,
            "offer-photo-x.jpg",
        ]) {
            expect(isRefusedPublicName(name)).toBe(true);
        }
    });

    test("everything else is served as before", () => {
        for (const name of [
            `${C}/picture-0123456789abcdef0123456789abcdef.jpg`,
            `${C}/image-1730000000000.png`,
            `${C}/cover-0123456789abcdef.webp`,
            `${C}/chat-attachment-0123456789abcdef0123456789abcdef.pdf`,
            `${C}/funding-ask-cover-1.jpg`,
            `${C}/my-offer-photo.jpg`,
            `offer-photo-folder/${C}/picture-1.jpg`,
            `${C}/photo-offer.jpg`,
            "",
        ]) {
            expect(isRefusedPublicName(name)).toBe(false);
        }
    });
});

let getObjectCalls = 0;
mock.module("minio", () => ({
    Client: class {
        getObject = async () => {
            getObjectCalls += 1;
            const { Readable } = await import("node:stream");
            return Readable.from([Buffer.from("image-bytes")]);
        };
    },
}));
process.env.MINIO_ROOT_USERNAME = "test";
process.env.MINIO_ROOT_PASSWORD = "test";

const storage = await import("@/app/storage/[...path]/route");
const uploads = await import("@/app/uploads/[...path]/route");

for (const [route, GET] of [
    ["/storage", storage.GET],
    ["/uploads", uploads.GET],
] as const) {
    const fetchAs = (ip: string | null, name: string) =>
        GET(new Request(`http://localhost${route}/${name}`, { headers: ip ? { "x-real-ip": ip } : {} }) as any, {
            params: Promise.resolve({ path: name.split("/") }),
        });

    describe(`${route} route`, () => {
        beforeEach(() => {
            resetStorageMissLimiter();
            getObjectCalls = 0;
        });

        test("refuses offer photos and verification attachments without asking MinIO", async () => {
            for (const name of [`${C}/offer-photo-1.jpg`, `${C}/verification-attachment1700.pdf`]) {
                const res = await fetchAs("9.9.9.9", name);
                expect(res.status).toBe(404);
                expect(await res.json()).toEqual({ error: "Not found" });
            }
            expect(getObjectCalls).toBe(0);
        });

        test("other images are still served", async () => {
            const res = await fetchAs("9.9.9.9", `${C}/picture-0123456789abcdef0123456789abcdef.png`);
            expect(res.status).toBe(200);
            expect(res.headers.get("content-type")).toBe("image/png");
            expect(getObjectCalls).toBe(1);
        });

        test("refusals count as misses, so a guesser is blocked like for missing objects", async () => {
            for (let i = 0; i < STORAGE_MAX_MISSES_PER_WINDOW; i++) await fetchAs("8.8.8.8", `${C}/offer-photo-${i}.jpg`);
            expect((await fetchAs("8.8.8.8", `${C}/picture-1.png`)).status).toBe(429);
            expect((await fetchAs("7.7.7.7", `${C}/picture-1.png`)).status).toBe(200);
        });

        test("internal requests (no client IP) are refused too", async () => {
            expect((await fetchAs(null, `${C}/offer-photo-1.jpg`)).status).toBe(404);
            expect(getObjectCalls).toBe(0);
        });
    });
}
