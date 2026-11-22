// Run: IS_BUILD=true bun test src/components/modules/members/update-user-groups.test.ts
// Taking the admin role away ("Remove admin role", updateUserGroupsAction) follows the removal rule
// (2026-11-22): groups and the creator come from the database; only a superadmin can demote the
// creator; the creator and superadmins demote an admin directly; another admin only creates a
// removal request the target must approve; never the last admin. No removal request may target the
// creator, and an older pending one can't be approved.
// The database is in-memory fakes (the removal requests too); the session is stubbed, permissions
// are the real isAuthorized.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { createFakeCollection } from "@/lib/testing/fake-collection";
import { defaultUserGroups } from "@/lib/data/constants";
import type { Circle, MemberDisplay } from "@/models/models";

const fakeDb = createFakeDb();
let requests = createFakeCollection();
// The driver cursor's next(), which getPendingAdminRoleRemovalRequest uses.
const withNext = (cursor: any): any => ({
    sort: (spec: any) => withNext(cursor.sort(spec)),
    limit: (n: number) => withNext(cursor.limit(n)),
    toArray: () => cursor.toArray(),
    next: async () => (await cursor.toArray())[0] ?? null,
});
const requestsCollection = {
    find: (filter: any) => withNext(requests.find(filter)),
    findOne: (...a: any[]) => (requests as any).findOne(...a),
    insertOne: (...a: any[]) => (requests as any).insertOne(...a),
    updateOne: (...a: any[]) => (requests as any).updateOne(...a),
};
mock.module("@/lib/data/db", () => ({ ...fakeDb.module, db: { collection: () => requestsCollection } }));

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realDetach = await import("@/lib/data/circle-detach");
mock.module("@/lib/data/circle-detach", () => ({
    ...realDetach,
    getPendingDetachCircleRequest: async () => null,
}));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCirclePath: async (circle: Partial<Circle>) => `/circles/${circle.handle}/`,
}));
const realNotifications = await import("@/lib/data/notifications");
mock.module("@/lib/data/notifications", () => ({ ...realNotifications, sendNotifications: async () => undefined }));

const { updateUserGroupsAction, approveAdminRoleRemovalRequestAction } = await import("./actions");

const BAND_ID = "64c300000000000000000001";
const CREATOR = "did:test:creator";
const ADMIN_A = "did:test:admin-a";
const ADMIN_B = "did:test:admin-b";
const MODERATOR = "did:test:moderator";
const MEMBER = "did:test:member";
const SUPERADMIN = "did:test:superadmin"; // not a member of the band

const user = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    circleType: "user",
    verificationStatus: "verified",
    ...extra,
});
const membership = (userDid: string, userGroups: string[]) => ({
    _id: new ObjectId(),
    userDid,
    circleId: BAND_ID,
    userGroups,
});

const band = { _id: BAND_ID, handle: "band", name: "Band" } as unknown as Circle;
const target = (userDid: string, claimedGroups: string[] = []) =>
    ({ userDid, userGroups: claimedGroups }) as unknown as MemberDisplay;
const DEMOTED = ["members"];

const groupsOf = async (did: string) =>
    ((await fakeDb.col("Members").findOne({ userDid: did, circleId: BAND_ID })) as any)?.userGroups;
const pendingRequests = () => requests.docs.filter((r) => r.status === "pending");

const seed = (adminsBesidesCreator: string[] = [ADMIN_A, ADMIN_B]) =>
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(BAND_ID),
                did: "did:test:band",
                handle: "band",
                name: "Band",
                circleType: "circle",
                createdBy: CREATOR,
                userGroups: defaultUserGroups,
            },
            user(CREATOR),
            user(ADMIN_A),
            user(ADMIN_B),
            user(MODERATOR),
            user(MEMBER),
            user(SUPERADMIN, { isAdmin: true }),
        ],
        Members: [
            membership(CREATOR, ["admins", "members"]),
            ...adminsBesidesCreator.map((did) => membership(did, ["admins", "members"])),
            membership(MODERATOR, ["moderators", "members"]),
            membership(MEMBER, ["members"]),
        ],
    });

beforeEach(() => {
    sessionDid = undefined;
    requests = createFakeCollection();
    seed();
});

describe("demoting an admin", () => {
    test("another admin only creates a request; the target keeps the role until they approve", async () => {
        sessionDid = ADMIN_A;
        const result = await updateUserGroupsAction(target(ADMIN_B), band, DEMOTED);
        expect(result.adminRoleRemovalRequestState).toBe("created");
        expect(await groupsOf(ADMIN_B)).toEqual(["admins", "members"]);
        expect(pendingRequests()).toHaveLength(1);

        sessionDid = ADMIN_B;
        const approved = await approveAdminRoleRemovalRequestAction(String(pendingRequests()[0]._id), band);
        expect(approved.success).toBe(true);
        expect(await groupsOf(ADMIN_B)).toEqual(["members"]);
    });

    test("the browser's claimed groups don't matter", async () => {
        sessionDid = ADMIN_A;
        const result = await updateUserGroupsAction(target(ADMIN_B, ["members"]), band, DEMOTED);
        expect(result.adminRoleRemovalRequestState).toBe("created");
        expect(await groupsOf(ADMIN_B)).toEqual(["admins", "members"]);
    });

    test("the creator demotes an admin directly", async () => {
        sessionDid = CREATOR;
        expect(await updateUserGroupsAction(target(ADMIN_B), band, DEMOTED)).toEqual({ success: true });
        expect(await groupsOf(ADMIN_B)).toEqual(["members"]);
        expect(requests.docs).toHaveLength(0);
    });

    test("a superadmin who isn't in the circle demotes an admin directly", async () => {
        sessionDid = SUPERADMIN;
        expect(await updateUserGroupsAction(target(ADMIN_B), band, DEMOTED)).toEqual({ success: true });
        expect(await groupsOf(ADMIN_B)).toEqual(["members"]);
        expect(requests.docs).toHaveLength(0);
    });

    test("an admin may still demote themselves", async () => {
        sessionDid = ADMIN_B;
        expect(await updateUserGroupsAction(target(ADMIN_B), band, DEMOTED)).toEqual({ success: true });
        expect(await groupsOf(ADMIN_B)).toEqual(["members"]);
    });

    test("a moderator can't demote an admin", async () => {
        sessionDid = MODERATOR;
        expect((await updateUserGroupsAction(target(ADMIN_B), band, DEMOTED)).success).toBe(false);
        expect(await groupsOf(ADMIN_B)).toEqual(["admins", "members"]);
        expect(requests.docs).toHaveLength(0);
    });
});

describe("demoting the creator", () => {
    test("another admin can't, not even as a request", async () => {
        sessionDid = ADMIN_A;
        const result = await updateUserGroupsAction(target(CREATOR), band, DEMOTED);
        expect(result.success).toBe(false);
        expect(result.message).toContain("creator");
        expect(await groupsOf(CREATOR)).toEqual(["admins", "members"]);
        expect(requests.docs).toHaveLength(0);
    });

    test("the creator can't demote themselves", async () => {
        sessionDid = CREATOR;
        expect((await updateUserGroupsAction(target(CREATOR), band, DEMOTED)).success).toBe(false);
        expect(await groupsOf(CREATOR)).toEqual(["admins", "members"]);
    });

    test("the creator can't demote themselves even as a superadmin (tim-solo, 2026-11-22)", async () => {
        await fakeDb.col("Circles").updateOne({ did: CREATOR }, { $set: { isAdmin: true } });
        sessionDid = CREATOR;
        const result = await updateUserGroupsAction(target(CREATOR), band, DEMOTED);
        expect(result).toEqual({
            success: false,
            message: "As the creator of this circle you can't give up the admin role.",
        });
        expect(await groupsOf(CREATOR)).toEqual(["admins", "members"]);
    });

    test("a superadmin can", async () => {
        sessionDid = SUPERADMIN;
        expect(await updateUserGroupsAction(target(CREATOR), band, DEMOTED)).toEqual({ success: true });
        expect(await groupsOf(CREATOR)).toEqual(["members"]);
    });

    test("an older pending request against the creator can't be approved", async () => {
        await requests.insertOne({
            _id: new ObjectId(),
            circleId: BAND_ID,
            targetUserDid: CREATOR,
            requestedByDid: ADMIN_A,
            status: "pending",
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        sessionDid = CREATOR;
        const result = await approveAdminRoleRemovalRequestAction(String(requests.docs[0]._id), band);
        expect(result.success).toBe(false);
        expect(await groupsOf(CREATOR)).toEqual(["admins", "members"]);
    });
});

describe("the last admin", () => {
    test("a superadmin can't demote the only admin", async () => {
        seed([]);
        sessionDid = SUPERADMIN;
        const result = await updateUserGroupsAction(target(CREATOR), band, DEMOTED);
        expect(result).toEqual({ success: false, message: "Cannot remove the last admin." });
        expect(await groupsOf(CREATOR)).toEqual(["admins", "members"]);
    });

    test("the only admin can't demote themselves", async () => {
        seed([]);
        await fakeDb.col("Circles").updateOne({ _id: new ObjectId(BAND_ID) }, { $set: { createdBy: "did:test:gone" } });
        sessionDid = CREATOR;
        const result = await updateUserGroupsAction(target(CREATOR), band, DEMOTED);
        expect(result).toEqual({ success: false, message: "Cannot remove the last admin." });
    });
});

describe("other role changes are unchanged", () => {
    test("an admin makes a member a moderator", async () => {
        sessionDid = ADMIN_A;
        expect(await updateUserGroupsAction(target(MEMBER), band, ["moderators", "members"])).toEqual({
            success: true,
        });
        expect(await groupsOf(MEMBER)).toEqual(["moderators", "members"]);
    });

    test("a moderator can't make anyone an admin", async () => {
        sessionDid = MODERATOR;
        await updateUserGroupsAction(target(MEMBER), band, ["admins", "members"]);
        expect(await groupsOf(MEMBER)).toEqual(["members"]);
    });

    test("signed out: nothing happens", async () => {
        expect((await updateUserGroupsAction(target(ADMIN_B), band, DEMOTED)).success).toBe(false);
        expect(await groupsOf(ADMIN_B)).toEqual(["admins", "members"]);
    });
});
