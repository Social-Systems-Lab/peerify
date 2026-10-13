// Run: bun test src/lib/data/rate-limit.test.ts
// RateLimits is a small in-memory stand-in that follows MongoDB's rules for updateOne with
// upsert: a filter miss inserts a document with the filter's _id, and inserting an _id that
// already exists fails with code 11000.

import { beforeEach, describe, expect, mock, test } from "bun:test";

type Doc = { _id: string; until: Date; expiresAt: Date };
let store = new Map<string, Doc>();

const fakeRateLimits = {
    createIndex: async () => "expiresAt_1",
    updateOne: async (filter: { _id: string; until: { $lte: Date } }, update: { $set: Omit<Doc, "_id"> }) => {
        const existing = store.get(filter._id);
        if (existing && existing.until.getTime() <= filter.until.$lte.getTime()) {
            store.set(filter._id, { _id: filter._id, ...update.$set });
            return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        }
        if (existing) {
            throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
        }
        store.set(filter._id, { _id: filter._id, ...update.$set });
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    },
    findOne: async (filter: { _id: string }) => store.get(filter._id) ?? null,
};
mock.module("./db", () => ({ RateLimits: fakeRateLimits }));
mock.module("@/lib/data/db", () => ({ RateLimits: fakeRateLimits }));

const { claimMinimumWait, rateLimitKey } = await import("./rate-limit");

const at = (s: number) => new Date(Date.UTC(2026, 9, 14, 8, 0, 0) + s * 1000);

describe("claimMinimumWait", () => {
    beforeEach(() => {
        store = new Map();
    });

    test("first claim is allowed and stores until/expiresAt", async () => {
        expect(await claimMinimumWait("k", 20, at(0))).toEqual({ allowed: true });
        expect(store.get("k")?.until).toEqual(at(20));
        expect(store.get("k")?.expiresAt).toEqual(at(20));
    });

    test("a claim inside the wait is refused with the seconds left", async () => {
        await claimMinimumWait("k", 20, at(0));
        expect(await claimMinimumWait("k", 20, at(5))).toEqual({ allowed: false, retryAfterSeconds: 15 });
    });

    test("allowed again exactly when the wait is over", async () => {
        await claimMinimumWait("k", 20, at(0));
        expect(await claimMinimumWait("k", 20, at(20))).toEqual({ allowed: true });
        expect(store.get("k")?.until).toEqual(at(40));
    });

    test("keys are independent", async () => {
        await claimMinimumWait("a", 20, at(0));
        expect(await claimMinimumWait("b", 20, at(1))).toEqual({ allowed: true });
    });

    test("other database errors are not swallowed", async () => {
        const original = fakeRateLimits.updateOne;
        fakeRateLimits.updateOne = async () => {
            throw Object.assign(new Error("not primary"), { code: 10107 });
        };
        try {
            let thrown: unknown;
            try {
                await claimMinimumWait("k", 20, at(0));
            } catch (error) {
                thrown = error;
            }
            expect((thrown as Error)?.message).toBe("not primary");
        } finally {
            fakeRateLimits.updateOne = original;
        }
    });

    test("keys hash the value, so no IP address is stored", () => {
        const key = rateLimitKey("login-link:ip", "203.0.113.7");
        expect(key.startsWith("login-link:ip:")).toBe(true);
        expect(key).not.toContain("203.0.113.7");
        expect(key).toBe(rateLimitKey("login-link:ip", "203.0.113.7"));
        expect(key).not.toBe(rateLimitKey("login-link:ip", "203.0.113.8"));
    });
});
