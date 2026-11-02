// Run: bun test src/lib/storage/miss-limiter.test.ts
// The limiter itself, then the /storage route with MinIO mocked (nothing is read from storage).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
    STORAGE_MAX_MISSES_PER_WINDOW,
    STORAGE_MISS_WINDOW_MS,
    recordStorageMiss,
    resetStorageMissLimiter,
    storageBlockedForSeconds,
} from "./miss-limiter";

describe("storage miss limiter", () => {
    beforeEach(() => resetStorageMissLimiter());

    test("blocks an IP after the allowed misses, until its window ends", () => {
        const start = 1_000_000;
        for (let i = 0; i < STORAGE_MAX_MISSES_PER_WINDOW - 1; i++) recordStorageMiss("1.2.3.4", start);
        expect(storageBlockedForSeconds("1.2.3.4", start)).toBe(0);

        recordStorageMiss("1.2.3.4", start);
        expect(storageBlockedForSeconds("1.2.3.4", start + 1000)).toBe(STORAGE_MISS_WINDOW_MS / 1000 - 1);
        expect(storageBlockedForSeconds("5.6.7.8", start)).toBe(0);
        expect(storageBlockedForSeconds("1.2.3.4", start + STORAGE_MISS_WINDOW_MS)).toBe(0);
    });
});

let objectExists = true;
mock.module("minio", () => ({
    Client: class {
        getObject = async () => {
            if (!objectExists) {
                throw Object.assign(new Error("The specified key does not exist."), { code: "NoSuchKey" });
            }
            const { Readable } = await import("node:stream");
            return Readable.from([Buffer.from("image-bytes")]);
        };
    },
}));
process.env.MINIO_ROOT_USERNAME = "test";
process.env.MINIO_ROOT_PASSWORD = "test";

const { GET } = await import("@/app/storage/[...path]/route");

const fetchAs = (ip: string | null, name: string) =>
    GET(new Request(`http://localhost/storage/${name}`, { headers: ip ? { "x-real-ip": ip } : {} }) as any, {
        params: Promise.resolve({ path: name.split("/") }),
    });

describe("/storage route", () => {
    beforeEach(() => {
        resetStorageMissLimiter();
        objectExists = true;
    });

    test("a missing object is a 404, and enough of them block hits too", async () => {
        objectExists = false;
        expect((await fetchAs("9.9.9.9", "c/guess.png")).status).toBe(404);
        for (let i = 1; i < STORAGE_MAX_MISSES_PER_WINDOW; i++) await fetchAs("9.9.9.9", `c/guess${i}.png`);

        objectExists = true;
        const blocked = await fetchAs("9.9.9.9", "c/real.png");
        expect(blocked.status).toBe(429);
        expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
        expect((await fetchAs("8.8.8.8", "c/real.png")).status).toBe(200);
    });

    test("internal requests (no X-Real-IP, e.g. next/image) are never blocked", async () => {
        objectExists = false;
        for (let i = 0; i < STORAGE_MAX_MISSES_PER_WINDOW + 5; i++) await fetchAs(null, `c/missing${i}.png`);

        objectExists = true;
        expect((await fetchAs(null, "c/real.png")).status).toBe(200);
    });
});
