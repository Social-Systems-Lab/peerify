// Run: IS_BUILD=true bun test src/components/modules/home/leave-circle.test.ts
// Leaving a circle (leaveCircle, the Follow button's "Stop following"), 2026-11-22. The creator
// can't leave, so a circle never loses its creator this way (only a superadmin can remove them).
// The last admin can't leave either. Both are read from the database, not from the circle object
// the client sends. The database is in-memory fakes; the session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import type { Circle } from "@/models/models";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realCookie = await import("@/lib/auth/cookie");
mock.module("@/lib/auth/cookie", () => ({ ...realCookie, readAuthToken: () => (sessionDid ? "token" : undefined) }));
const realJwt = await import("@/lib/auth/jwt");
mock.module("@/lib/auth/jwt", () => ({ ...realJwt, verifyUserToken: async () => ({ userDid: sessionDid }) }));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
let pendingDetach: unknown = null;
const realDetach = await import("@/lib/data/circle-detach");
mock.module("@/lib/data/circle-detach", () => ({
    ...realDetach,
    getPendingDetachCircleRequest: async () => pendingDetach,
}));

const { leaveCircle } = await import("./actions");

const BAND_ID = "64c400000000000000000001";
const CREATOR = "did:test:creator";
const ADMIN = "did:test:admin";
const MEMBER = "did:test:member";

const membership = (userDid: string, userGroups: string[]) => ({
    _id: new ObjectId(),
    userDid,
    circleId: BAND_ID,
    userGroups,
});
const isMember = (did: string) => fakeDb.col("Members").findOne({ userDid: did, circleId: BAND_ID });

// What the client sends; createdBy is deliberately wrong to show it isn't trusted.
const band = { _id: BAND_ID, handle: "band", circleType: "circle", createdBy: "did:test:someone" } as unknown as Circle;

const seed = (members: ReturnType<typeof membership>[], createdBy = CREATOR) =>
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(BAND_ID), did: "did:test:band", handle: "band", circleType: "circle", createdBy },
        ],
        Members: members,
    });

beforeEach(() => {
    sessionDid = undefined;
    pendingDetach = null;
    seed([
        membership(CREATOR, ["admins", "members"]),
        membership(ADMIN, ["admins", "members"]),
        membership(MEMBER, ["members"]),
    ]);
});

describe("leaving a circle", () => {
    test("the creator can't leave, even with another admin in place", async () => {
        sessionDid = CREATOR;
        const result = await leaveCircle(band);
        expect(result.success).toBe(false);
        expect(result.message).toContain("creator");
        expect(await isMember(CREATOR)).not.toBeNull();
    });

    test("the creator can't leave even when they're no longer an admin", async () => {
        seed([membership(CREATOR, ["members"]), membership(ADMIN, ["admins", "members"])]);
        sessionDid = CREATOR;
        expect((await leaveCircle(band)).success).toBe(false);
        expect(await isMember(CREATOR)).not.toBeNull();
    });

    test("another admin can leave while one admin remains", async () => {
        sessionDid = ADMIN;
        expect((await leaveCircle(band)).success).toBe(true);
        expect(await isMember(ADMIN)).toBeNull();
    });

    test("the last admin can't leave", async () => {
        // A circle whose creator is gone, with one admin left.
        seed([membership(ADMIN, ["admins", "members"]), membership(MEMBER, ["members"])], "did:test:gone");
        sessionDid = ADMIN;
        const result = await leaveCircle(band);
        expect(result).toEqual({ success: false, message: "Cannot leave as last admin." });
        expect(await isMember(ADMIN)).not.toBeNull();
    });

    test("no admin leaves while a detach request is pending", async () => {
        pendingDetach = { _id: "detach-1" };
        sessionDid = ADMIN;
        expect((await leaveCircle(band)).success).toBe(false);
        expect(await isMember(ADMIN)).not.toBeNull();
    });

    test("a member leaves as before", async () => {
        sessionDid = MEMBER;
        expect((await leaveCircle(band)).success).toBe(true);
        expect(await isMember(MEMBER)).toBeNull();
    });

    test("signed out: nothing happens", async () => {
        expect((await leaveCircle(band)).success).toBe(false);
    });
});
