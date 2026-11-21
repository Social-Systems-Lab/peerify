// Run: IS_BUILD=true bun test src/components/modules/home/draft-follow.test.ts
// L1 (draft artist profiles, 2026-11-21): followCircle and applyForCrewMembership took any circle
// id. A draft is created isPublic: true, so a stranger who knew its _id joined it straight away and
// then got its name, bio and location through their memberships. Both now answer "not found" for
// an unpublished circle unless the caller may already open it (creator, admins, moderators). The
// database is in-memory fakes (testing/fake-db.ts); nothing real is touched.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const DRAFT_ID = "64a000000000000000000d01";
const OWNER = "did:test:owner";
const STRANGER = "did:test:stranger";
let sessionDid = STRANGER;
let circleUnderTest: any;

mock.module("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
const realCookie = await import("@/lib/auth/cookie");
mock.module("@/lib/auth/cookie", () => ({ ...realCookie, readAuthToken: () => "token" }));
const realJwt = await import("@/lib/auth/jwt");
mock.module("@/lib/auth/jwt", () => ({ ...realJwt, verifyUserToken: async () => ({ userDid: sessionDid }) }));
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async () => false,
    getAuthorizedMembers: async () => [],
}));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({ ...realCircle, getCircleById: async () => circleUnderTest }));
const realUser = await import("@/lib/data/user");
mock.module("@/lib/data/user", () => ({
    ...realUser,
    getUser: async (did: string) => ({ did, name: did }),
    getUserPrivate: async (did: string) => ({ did, name: did }),
}));
const realNotifications = await import("@/lib/data/notifications");
mock.module("@/lib/data/notifications", () => ({ ...realNotifications, sendNotifications: async () => undefined }));

const { followCircle, applyForCrewMembership } = await import("./actions");

const artist = (publishStatus?: string) =>
    ({
        _id: DRAFT_ID,
        did: "did:test:artist",
        handle: "draft-artist",
        name: "Draft Artist",
        description: "Unpublished bio",
        circleType: "circle",
        isPublic: true,
        createdBy: OWNER,
        enabledModules: ["home", "music", "crew"],
        metadata: { peerify: { managedIdentity: true, identityType: "artist" } },
        ...(publishStatus ? { publishStatus } : {}),
    }) as any;

beforeEach(() => {
    sessionDid = STRANGER;
    // addMember reads the circle by ObjectId.
    fakeDb.reset({ Circles: [{ ...artist("draft"), _id: new ObjectId(DRAFT_ID) }] });
});

describe("following an unpublished circle by id", () => {
    for (const status of ["draft", "pending_verification"]) {
        test(`${status}: a stranger gets "Circle not found" and is not added`, async () => {
            circleUnderTest = artist(status);
            const result = await followCircle(circleUnderTest, {});
            expect(result).toEqual({ success: false, message: "Circle not found" });
            expect(await fakeDb.col("Members").countDocuments({ circleId: DRAFT_ID })).toBe(0);
        });
    }

    test("the same answer as an id that doesn't exist", async () => {
        circleUnderTest = undefined;
        const missing = await followCircle({ _id: DRAFT_ID } as any, {});
        circleUnderTest = artist("draft");
        expect(await followCircle(circleUnderTest, {})).toEqual(missing);
    });

    test("a published circle still joins as before", async () => {
        circleUnderTest = artist("published");
        const result = await followCircle(circleUnderTest, {});
        expect(result.success).toBe(true);
        expect(await fakeDb.col("Members").countDocuments({ circleId: DRAFT_ID, userDid: STRANGER })).toBe(1);
    });

    test("a circle with no publishStatus (older circles) counts as published", async () => {
        circleUnderTest = artist();
        expect((await followCircle(circleUnderTest, {})).success).toBe(true);
    });

    test("the draft's creator is not refused", async () => {
        sessionDid = OWNER;
        circleUnderTest = artist("draft");
        expect((await followCircle(circleUnderTest, {})).success).toBe(true);
    });
});

describe("applying to an unpublished circle's Crew", () => {
    test('a stranger gets "Circle not found" and no application is stored', async () => {
        circleUnderTest = artist("draft");
        const result = await applyForCrewMembership(circleUnderTest, "hi");
        expect(result).toEqual({ success: false, message: "Circle not found" });
        expect(await fakeDb.col("CrewApplications").countDocuments({})).toBe(0);
    });

    test("a published artist still takes applications", async () => {
        circleUnderTest = artist("published");
        const result = await applyForCrewMembership(circleUnderTest, "hi");
        expect(result.success).toBe(true);
    });
});
