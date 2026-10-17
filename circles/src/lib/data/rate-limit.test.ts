// Run: bun test src/lib/data/rate-limit.test.ts
// RateLimits is a small in-memory stand-in that follows MongoDB's rules for updateOne with
// upsert: a filter miss inserts a document with the filter's _id, and inserting an _id that
// already exists fails with code 11000.

import { beforeEach, describe, expect, mock, test } from "bun:test";

type Doc = { _id: string; until: Date; expiresAt: Date; failures?: number };
type Update = {
    $inc?: { failures: number };
    $set?: Partial<Doc>;
    $setOnInsert?: Partial<Doc>;
    $max?: { until: Date };
};
// Set to make the next upsert fail like a concurrent insert of the same _id.
let failNextUpsert = false;
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
    findOneAndUpdate: async (filter: { _id: string }, update: Update, options?: { upsert?: boolean }) => {
        let doc = store.get(filter._id);
        if (!doc) {
            if (!options?.upsert) return null;
            if (failNextUpsert) {
                failNextUpsert = false;
                store.set(filter._id, { _id: filter._id, until: new Date(0), expiresAt: new Date(8.64e15), failures: 1 });
                throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
            }
            doc = { _id: filter._id, until: new Date(0), expiresAt: new Date(0), ...update.$setOnInsert };
        }
        doc = { ...doc, ...update.$set };
        if (update.$inc) doc.failures = (doc.failures ?? 0) + update.$inc.failures;
        if (update.$max && update.$max.until > doc.until) doc.until = update.$max.until;
        store.set(filter._id, doc);
        return doc;
    },
    deleteOne: async (filter: { _id: string; expiresAt?: { $lte: Date } }) => {
        const doc = store.get(filter._id);
        if (doc && (!filter.expiresAt || doc.expiresAt <= filter.expiresAt.$lte)) {
            store.delete(filter._id);
            return { deletedCount: 1 };
        }
        return { deletedCount: 0 };
    },
};
mock.module("./db", () => ({ RateLimits: fakeRateLimits }));
mock.module("@/lib/data/db", () => ({ RateLimits: fakeRateLimits }));

const { checkFailureDelay, claimMinimumWait, clearFailures, failureDelaySeconds, rateLimitKey, recordFailure } =
    await import("./rate-limit");

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

describe("failed-attempt delay", () => {
    beforeEach(() => {
        store = new Map();
        failNextUpsert = false;
    });

    test("schedule: 4 free failures, then 30 s doubling, capped at 15 min", () => {
        const delays = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 50].map(failureDelaySeconds);
        expect(delays).toEqual([0, 0, 0, 0, 0, 30, 60, 120, 240, 480, 900, 900, 900]);
    });

    test("5 attempts are free; after the 5th failure the next waits 30 s", async () => {
        for (let i = 1; i <= 4; i++) {
            await recordFailure("k", at(i));
            expect(await checkFailureDelay("k", at(i))).toEqual({ allowed: true });
        }
        expect(await recordFailure("k", at(5))).toEqual({ failures: 5 });
        expect(await checkFailureDelay("k", at(5))).toEqual({ allowed: false, retryAfterSeconds: 30 });
        expect(await checkFailureDelay("k", at(34))).toEqual({ allowed: false, retryAfterSeconds: 1 });
        expect(await checkFailureDelay("k", at(35))).toEqual({ allowed: true });
    });

    test("each further failure doubles the wait", async () => {
        for (let i = 1; i <= 5; i++) await recordFailure("k", at(0));
        await recordFailure("k", at(100));
        expect(await checkFailureDelay("k", at(100))).toEqual({ allowed: false, retryAfterSeconds: 60 });
        await recordFailure("k", at(200));
        expect(await checkFailureDelay("k", at(200))).toEqual({ allowed: false, retryAfterSeconds: 120 });
    });

    test("never more than 15 minutes", async () => {
        for (let i = 0; i < 30; i++) await recordFailure("k", at(0));
        expect(await checkFailureDelay("k", at(0))).toEqual({ allowed: false, retryAfterSeconds: 900 });
    });

    test("a success clears the counter", async () => {
        for (let i = 0; i < 5; i++) await recordFailure("k", at(0));
        await clearFailures("k");
        expect(await checkFailureDelay("k", at(0))).toEqual({ allowed: true });
        expect(await recordFailure("k", at(1))).toEqual({ failures: 1 });
    });

    test("24 h after the last failure the counter starts over", async () => {
        for (let i = 0; i < 5; i++) await recordFailure("k", at(0));
        expect(await checkFailureDelay("k", at(24 * 3600))).toEqual({ allowed: true });
        expect(await recordFailure("k", at(24 * 3600))).toEqual({ failures: 1 });
        expect(await checkFailureDelay("k", at(24 * 3600))).toEqual({ allowed: true });
    });

    test("a concurrent first failure (duplicate key) still counts", async () => {
        failNextUpsert = true;
        expect(await recordFailure("k", at(0))).toEqual({ failures: 2 });
    });

    test("keys are independent", async () => {
        for (let i = 0; i < 5; i++) await recordFailure("a", at(0));
        expect(await checkFailureDelay("b", at(0))).toEqual({ allowed: true });
    });
});
