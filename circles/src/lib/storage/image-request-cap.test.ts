// Run: bun test src/lib/storage/image-request-cap.test.ts
// The /_next/image per-IP cap, then middleware() with it (no server, no database).

import { beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import {
    IMAGE_REQUESTS_PER_WINDOW,
    IMAGE_REQUEST_WINDOW_MS,
    isStoredFileImageRequest,
    resetImageRequestCap,
    takeImageRequest,
} from "./image-request-cap";

describe("image request cap", () => {
    beforeEach(() => resetImageRequestCap());

    test("only /_next/image for stored files counts", () => {
        const params = (url: string) => new URLSearchParams({ url, w: "640", q: "75" });
        expect(isStoredFileImageRequest("/_next/image", params("/storage/c/a.png"))).toBe(true);
        expect(isStoredFileImageRequest("/_next/image", params("/uploads/a.png"))).toBe(true);
        expect(isStoredFileImageRequest("/_next/image", params("/peerify/fans.jpg"))).toBe(false);
        expect(isStoredFileImageRequest("/storage/c/a.png", params("/storage/c/a.png"))).toBe(false);
    });

    test("allows the cap per window, then refuses until the window ends", () => {
        const start = 5_000_000;
        for (let i = 0; i < IMAGE_REQUESTS_PER_WINDOW; i++) expect(takeImageRequest("1.2.3.4", start)).toBe(0);
        expect(takeImageRequest("1.2.3.4", start + 1000)).toBe(IMAGE_REQUEST_WINDOW_MS / 1000 - 1);
        expect(takeImageRequest("5.6.7.8", start + 1000)).toBe(0);
        expect(takeImageRequest("1.2.3.4", start + IMAGE_REQUEST_WINDOW_MS)).toBe(0);
    });
});

describe("middleware on /_next/image", async () => {
    const { middleware, config } = await import("@/middleware");
    // middleware() can return undefined on other paths; on /_next/image it always returns a response.
    const run = async (request: NextRequest) => (await middleware(request))!;
    const imageRequest = (ip: string | null, url = "/storage/c/a.png") =>
        new NextRequest(`http://localhost/_next/image?url=${encodeURIComponent(url)}&w=640&q=75`, {
            headers: ip ? { "x-real-ip": ip } : {},
        });

    beforeEach(() => resetImageRequestCap());

    test("is matched", () => {
        expect(config.matcher).toContain("/_next/image");
    });

    test("passes under the cap, 429 over it, others unaffected", async () => {
        for (let i = 0; i < IMAGE_REQUESTS_PER_WINDOW; i++) {
            expect((await run(imageRequest("9.9.9.9"))).status).toBe(200);
        }
        const refused = await run(imageRequest("9.9.9.9"));
        expect(refused.status).toBe(429);
        expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
        expect((await run(imageRequest("8.8.8.8"))).status).toBe(200);
        expect((await run(imageRequest("9.9.9.9", "/peerify/fans.jpg"))).status).toBe(200);
    });

    test("no X-Real-IP (local dev) is never capped", async () => {
        for (let i = 0; i < IMAGE_REQUESTS_PER_WINDOW + 5; i++) await run(imageRequest(null));
        expect((await run(imageRequest(null))).status).toBe(200);
    });
});
