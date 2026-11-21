// Run: IS_BUILD=true bun test src/lib/data/draft-platform-count.test.ts
// L6 (draft artist profiles, 2026-11-21): countCirclesAndUsers (getPlatformMetrics, shown in
// onboarding without sign-in) counted every circle, so a bulk import of drafts raised the public
// circle count. It now counts published circles only (publishStatus "published" or missing).
// The database is in-memory fakes.

import { beforeEach, expect, mock, test } from "bun:test";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const { countCirclesAndUsers } = await import("./circle");

beforeEach(() => {
    fakeDb.reset({
        Circles: [
            { _id: "c1", circleType: "circle", publishStatus: "published" },
            { _id: "c2", circleType: "circle" },
            { _id: "c3", circleType: "circle", publishStatus: "draft" },
            { _id: "c4", circleType: "circle", publishStatus: "pending_verification" },
            { _id: "u1", circleType: "user" },
            { _id: "u2", circleType: "user", publishStatus: "published" },
        ],
    });
});

test("drafts and pending circles aren't counted; published and older (no status) circles are", async () => {
    expect((await countCirclesAndUsers()).circles).toBe(2);
});

test("the user count is unchanged", async () => {
    expect((await countCirclesAndUsers()).users).toBe(2);
});
