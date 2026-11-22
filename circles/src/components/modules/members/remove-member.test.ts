// Run: IS_BUILD=true bun test src/components/modules/members/remove-member.test.ts
// Removing a member (2026-11-22). removeMemberAction used to decide "is the target an admin?" from the
// userGroups of the member object the browser sent, so an admin could send an admin's or the
// creator's DID with userGroups: [] and remove them outright. Now the target's groups and the
// circle's creator come from the database:
// - only a superadmin can remove the creator;
// - the creator and superadmins remove an admin directly, another admin only creates a removal request;
// - never the last admin.
// The database is in-memory fakes; the session is stubbed, permissions are the real isAuthorized.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { defaultUserGroups } from "@/lib/data/constants";
import type { Circle, MemberDisplay } from "@/models/models";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

// The removal-request and detach stores use db.collection(...), which the fake doesn't provide.
let removalRequests: { circleId: string; targetUserDid: string; requestedByDid: string }[] = [];
const realRemoval = await import("@/lib/data/admin-role-removal");
mock.module("@/lib/data/admin-role-removal", () => ({
    ...realRemoval,
    createAdminRoleRemovalRequest: async (params: {
        circleId: string;
        targetUserDid: string;
        requestedByDid: string;
    }) => {
        removalRequests.push(params);
        return { created: true };
    },
}));
let pendingDetach: unknown = null;
const realDetach = await import("@/lib/data/circle-detach");
mock.module("@/lib/data/circle-detach", () => ({
    ...realDetach,
    getPendingDetachCircleRequest: async () => pendingDetach,
}));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCirclePath: async (circle: Partial<Circle>) => `/circles/${circle.handle}/`,
}));
const realNotifications = await import("@/lib/data/notifications");
mock.module("@/lib/data/notifications", () => ({ ...realNotifications, sendNotifications: async () => undefined }));

const { removeMemberAction } = await import("./actions");

const BAND_ID = "64c100000000000000000001";
const BAND_DID = "did:test:band"; // the band circle's own identity, not a person
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
// What the browser sends: only userDid should matter, userGroups is whatever the caller claims.
const target = (userDid: string, claimedGroups: string[] = []) =>
    ({ userDid, userGroups: claimedGroups }) as unknown as MemberDisplay;

const isMember = (did: string) => fakeDb.col("Members").findOne({ userDid: did, circleId: BAND_ID });

const seed = (adminsBesidesCreator: string[] = [ADMIN_A, ADMIN_B]) =>
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(BAND_ID),
                did: BAND_DID,
                handle: "band",
                name: "Band",
                circleType: "circle",
                createdBy: CREATOR,
                userGroups: defaultUserGroups,
                members: 6,
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
    removalRequests = [];
    pendingDetach = null;
    seed();
});

describe("the bypass: the browser's userGroups are ignored", () => {
    test("an admin sending another admin with userGroups: [] only creates a removal request", async () => {
        sessionDid = ADMIN_A;
        const result = await removeMemberAction(target(ADMIN_B, []), band);
        expect(result.adminRoleRemovalRequestState).toBe("created");
        expect(removalRequests).toEqual([{ circleId: BAND_ID, targetUserDid: ADMIN_B, requestedByDid: ADMIN_A }]);
        expect(await isMember(ADMIN_B)).not.toBeNull();
    });

    test("an admin sending the creator with userGroups: [] is refused", async () => {
        sessionDid = ADMIN_A;
        const result = await removeMemberAction(target(CREATOR, []), band);
        expect(result.success).toBe(false);
        expect(result.message).toContain("creator");
        expect(removalRequests).toEqual([]);
        expect(await isMember(CREATOR)).not.toBeNull();
    });

    test("claiming a plain member is an admin doesn't turn the removal into a request", async () => {
        sessionDid = ADMIN_A;
        const result = await removeMemberAction(target(MEMBER, ["admins"]), band);
        expect(result).toEqual({ success: true });
        expect(removalRequests).toEqual([]);
        expect(await isMember(MEMBER)).toBeNull();
    });
});

describe("removing an admin", () => {
    test("another admin only creates a request the target must approve", async () => {
        sessionDid = ADMIN_A;
        const result = await removeMemberAction(target(ADMIN_B, ["admins", "members"]), band);
        expect(result.success).toBe(true);
        expect(result.adminRoleRemovalRequestState).toBe("created");
        expect(await isMember(ADMIN_B)).not.toBeNull();
    });

    test("the creator removes an admin directly", async () => {
        sessionDid = CREATOR;
        const result = await removeMemberAction(target(ADMIN_B, ["admins", "members"]), band);
        expect(result).toEqual({ success: true });
        expect(removalRequests).toEqual([]);
        expect(await isMember(ADMIN_B)).toBeNull();
    });

    test("a superadmin who isn't in the circle removes an admin directly", async () => {
        sessionDid = SUPERADMIN;
        const result = await removeMemberAction(target(ADMIN_B, ["admins", "members"]), band);
        expect(result).toEqual({ success: true });
        expect(removalRequests).toEqual([]);
        expect(await isMember(ADMIN_B)).toBeNull();
    });

    test("an admin may still remove themselves", async () => {
        sessionDid = ADMIN_B;
        const result = await removeMemberAction(target(ADMIN_B), band);
        expect(result).toEqual({ success: true });
        expect(await isMember(ADMIN_B)).toBeNull();
    });

    test("a moderator can't remove an admin", async () => {
        sessionDid = MODERATOR;
        const result = await removeMemberAction(target(ADMIN_B), band);
        expect(result.success).toBe(false);
        expect(removalRequests).toEqual([]);
        expect(await isMember(ADMIN_B)).not.toBeNull();
    });

    test("no admin changes while a detach request is pending, even for the creator", async () => {
        pendingDetach = { _id: "detach-1" };
        sessionDid = CREATOR;
        const result = await removeMemberAction(target(ADMIN_B), band);
        expect(result.success).toBe(false);
        expect(await isMember(ADMIN_B)).not.toBeNull();
    });
});

describe("removing the creator", () => {
    test("a superadmin can", async () => {
        sessionDid = SUPERADMIN;
        const result = await removeMemberAction(target(CREATOR), band);
        expect(result).toEqual({ success: true });
        expect(await isMember(CREATOR)).toBeNull();
    });

    test("the creator can't remove themselves here", async () => {
        sessionDid = CREATOR;
        const result = await removeMemberAction(target(CREATOR), band);
        expect(result.success).toBe(false);
        expect(await isMember(CREATOR)).not.toBeNull();
    });

    test("a moderator can't", async () => {
        sessionDid = MODERATOR;
        const result = await removeMemberAction(target(CREATOR), band);
        expect(result.success).toBe(false);
        expect(await isMember(CREATOR)).not.toBeNull();
    });
});

describe("the last admin", () => {
    test("a superadmin can't remove the only admin", async () => {
        seed([]); // the creator is the only admin
        sessionDid = SUPERADMIN;
        const result = await removeMemberAction(target(CREATOR), band);
        expect(result).toEqual({ success: false, message: "Cannot remove the last admin." });
        expect(await isMember(CREATOR)).not.toBeNull();
    });

    test("the only admin can't remove themselves", async () => {
        seed([]);
        fakeDb.col("Circles").updateOne({ _id: new ObjectId(BAND_ID) }, { $set: { createdBy: "did:test:gone" } });
        sessionDid = CREATOR;
        const result = await removeMemberAction(target(CREATOR), band);
        expect(result).toEqual({ success: false, message: "Cannot remove the last admin." });
    });
});

describe("ordinary members", () => {
    test("an admin removes a member directly", async () => {
        sessionDid = ADMIN_A;
        expect(await removeMemberAction(target(MEMBER), band)).toEqual({ success: true });
        expect(await isMember(MEMBER)).toBeNull();
    });

    test("a plain member can't remove anyone", async () => {
        sessionDid = MEMBER;
        const result = await removeMemberAction(target(MODERATOR), band);
        expect(result.success).toBe(false);
        expect(await isMember(MODERATOR)).not.toBeNull();
    });

    test("signed out: nothing happens", async () => {
        const result = await removeMemberAction(target(MEMBER), band);
        expect(result.success).toBe(false);
        expect(await isMember(MEMBER)).not.toBeNull();
    });

    test("someone who isn't a member: refused", async () => {
        sessionDid = ADMIN_A;
        const result = await removeMemberAction(target("did:test:nobody"), band);
        expect(result.success).toBe(false);
    });
});
