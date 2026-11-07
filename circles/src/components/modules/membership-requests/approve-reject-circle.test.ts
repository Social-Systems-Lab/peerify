// Run: IS_BUILD=true bun test src/components/modules/membership-requests/approve-reject-circle.test.ts
// Leak round 3, integrity item (2026-11-07): approveMembershipRequestAction/rejectMembershipRequestAction
// check permission on the circle the client sends, but never checked that the request belongs to
// that circle. An admin of circle X could send circle Y's request id with circle X and approve Y's
// requester as a follower of X (Y's request marked approved), or reject Y's request. Both are now
// refused, the same way as crew applications (0be44136). The database is in-memory fakes
// (testing/fake-db.ts); nothing real is touched.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_X = "64a000000000000000000d01"; // the admin's own circle
const CIRCLE_Y = "64a000000000000000000d02"; // someone else's
const ADMIN_X = "did:test:admin-x";
const REQUESTER_X = "did:test:requester-x";
const REQUESTER_Y = "did:test:requester-y";
const REQ_X = "64a00000000000000000b001";
const REQ_Y = "64a00000000000000000b002";

const memberWrites: { userDid: string; circleId: string }[] = [];
const notified: string[] = [];

mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => ADMIN_X,
    // The admin manages circle X only.
    isAuthorized: async (did: string | undefined, circleId: string) => did === ADMIN_X && circleId === CIRCLE_X,
}));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCirclePath: async (circle: { handle?: string }) => `/circles/${circle.handle}/`,
}));
const realMember = await import("@/lib/data/member");
mock.module("@/lib/data/member", () => ({
    ...realMember,
    addMember: async (userDid: string, circleId: string) => {
        memberWrites.push({ userDid, circleId });
    },
}));
const realNotifications = await import("@/lib/data/notifications");
mock.module("@/lib/data/notifications", () => ({
    ...realNotifications,
    notifyNewMember: async (userDid: string) => {
        notified.push(userDid);
    },
}));

const { approveMembershipRequestAction, rejectMembershipRequestAction } = await import("./actions");

const circleX = { _id: CIRCLE_X, handle: "x", name: "X" } as any;
const statusOf = (id: string) => fakeDb.col("MembershipRequests").docs.find((d: any) => String(d._id) === id)?.status;

beforeEach(() => {
    memberWrites.length = 0;
    notified.length = 0;
    fakeDb.reset({
        MembershipRequests: [
            { _id: new ObjectId(REQ_X), userDid: REQUESTER_X, circleId: CIRCLE_X, status: "pending", requestedAt: new Date() },
            { _id: new ObjectId(REQ_Y), userDid: REQUESTER_Y, circleId: CIRCLE_Y, status: "pending", requestedAt: new Date() },
        ],
    });
});

describe("approve", () => {
    test("another circle's request, sent with the admin's own circle: refused, nothing changes", async () => {
        const result = await approveMembershipRequestAction(REQ_Y, circleX);

        expect(result).toEqual({ success: false, message: "This request isn't for this circle." });
        expect(statusOf(REQ_Y)).toBe("pending");
        expect(memberWrites).toEqual([]); // requester Y not added to circle X
        expect(notified).toEqual([]);
    });

    test("a request to the admin's own circle: approved as before", async () => {
        const result = await approveMembershipRequestAction(REQ_X, circleX);

        expect(result.success).toBe(true);
        expect(statusOf(REQ_X)).toBe("approved");
        expect(memberWrites).toEqual([{ userDid: REQUESTER_X, circleId: CIRCLE_X }]);
        expect(notified).toEqual([REQUESTER_X]);
    });

    test("another circle, sent with that circle: refused by the permission check, as before", async () => {
        const result = await approveMembershipRequestAction(REQ_Y, { _id: CIRCLE_Y, handle: "y" } as any);
        expect(result.success).toBe(false);
        expect(statusOf(REQ_Y)).toBe("pending");
    });
});

describe("reject", () => {
    test("another circle's request, sent with the admin's own circle: refused, nothing changes", async () => {
        const result = await rejectMembershipRequestAction(REQ_Y, circleX);

        expect(result).toEqual({ success: false, message: "This request isn't for this circle." });
        expect(statusOf(REQ_Y)).toBe("pending");
    });

    test("a request to the admin's own circle: rejected as before", async () => {
        const result = await rejectMembershipRequestAction(REQ_X, circleX);

        expect(result.success).toBe(true);
        expect(statusOf(REQ_X)).toBe("rejected");
    });
});
