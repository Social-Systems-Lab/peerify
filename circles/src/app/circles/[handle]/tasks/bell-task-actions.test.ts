// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/bell-task-actions.test.ts"
// Backlog item 3 (2026-11-25): the bell's Approve and Accept buttons call reviewTaskClaimAction and
// acceptTaskAction with the circle handle, task id and (for Approve) the claim id that
// listNotificationsForUser worked out from the claimant's did. These tests run that path end to end
// on fakes: the right person succeeds and the notice then reads "not needed"; anyone else calling the
// same action from a notice is refused and nothing changes.
// The database is in-memory fakes; the session and notifications are stubbed, and the permission
// check is "admin of that circle", read from the fake Members.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";
import { getTaskNoticeAction, type TaskActionFacts } from "@/lib/data/notification-action-state";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_ID = "64f800000000000000000a11";
const TASK_ID = "64f8000000000000000000e1";
const ORGANISER = "did:test:organiser";
const CLAIMANT = "did:test:claimant";
const OTHER_MEMBER = "did:test:other-member";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) => {
        if (feature === features.tasks.view) return true;
        return fakeDb
            .col("Members")
            .docs.some((m) => m.userDid === did && m.circleId === String(circleId) && m.userGroups.includes("admins"));
    },
}));
mock.module("@/lib/auth/verification", () => ({
    canPerformRestrictedAction: () => true,
    getRestrictedActionMessage: (action: string) => `You can't ${action} yet.`,
}));
const notified: string[] = [];
const realNotifications = await import("@/lib/data/notifications");
mock.module("@/lib/data/notifications", () =>
    Object.fromEntries(
        Object.entries(realNotifications).map(([name, value]) => [
            name,
            name.startsWith("notify")
                ? async () => {
                      notified.push(name);
                  }
                : value,
        ]),
    ),
);
const realUser = await import("@/lib/data/user");
mock.module("@/lib/data/user", () => ({
    ...realUser,
    getUserByDid: async (did: string) => ({ did, handle: did.split(":").pop(), name: did, circleType: "user" }),
    getUserPrivate: async (did: string) => ({ did, handle: did.split(":").pop(), name: did, circleType: "user" }),
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCircleByHandle: async (handle: string) => {
        const circle = fakeDb.col("Circles").docs.find((c) => c.handle === handle);
        return circle ? { ...circle, _id: circle._id.toString() } : null;
    },
}));

const { reviewTaskClaimAction, acceptTaskAction } = await import("./actions");

const member = (userDid: string, userGroups: string[]) => ({
    _id: new ObjectId(),
    circleId: CIRCLE_ID,
    userDid,
    userGroups,
});
const past = new Date("2026-11-20T00:00:00Z");

const seed = (task: Record<string, unknown>) => {
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(CIRCLE_ID),
                did: "did:test:artist",
                handle: "artist",
                circleType: "circle",
                enabledModules: ["tasks"],
            },
        ],
        Members: [
            member(ORGANISER, ["admins", "members"]),
            member(CLAIMANT, ["members", "crew"]),
            member(OTHER_MEMBER, ["members", "crew"]),
        ],
        Tasks: [
            {
                _id: new ObjectId(TASK_ID),
                circleId: CIRCLE_ID,
                createdBy: ORGANISER,
                title: "Carry chairs",
                userGroups: ["everyone"],
                taskType: "outcome",
                stage: "open",
                ...task,
            },
        ],
    });
    fakeDb.setAggregateResult("Tasks", fakeDb.col("Tasks").docs, { applyLeadingMatch: true });
};

const storedTask = (): TaskActionFacts => {
    const doc = fakeDb.col("Tasks").docs[0];
    return { ...doc, _id: String(doc._id) } as TaskActionFacts;
};
const snapshot = () => JSON.stringify(fakeDb.col("Tasks").docs);

// What the bell holds for each notice (content as stored by notifyTaskClaimSubmitted etc.).
const claimNoticeContent = { user: { did: CLAIMANT }, taskId: TASK_ID, circle: { handle: "artist" } };
const assigneeNoticeContent = { user: { did: ORGANISER }, taskId: TASK_ID, circle: { handle: "artist" } };

beforeEach(() => {
    sessionDid = undefined;
    notified.length = 0;
});

describe("Approve from a claim notice", () => {
    beforeEach(() =>
        seed({ claims: [{ claimId: "claim-1", claimantDid: CLAIMANT, status: "pending", createdAt: past }] }),
    );

    test("the organiser approves with the claim id the bell was given; the notice then clears", async () => {
        const before = getTaskNoticeAction("task_claim_submitted", claimNoticeContent, storedTask(), ORGANISER);
        expect(before).toEqual({ needed: true, claimId: "claim-1" });

        sessionDid = ORGANISER;
        const result = await reviewTaskClaimAction("artist", TASK_ID, before!.claimId!, "approved");

        expect(result.success).toBe(true);
        expect(storedTask().assignedTo).toBe(CLAIMANT);
        expect(notified).toContain("notifyTaskClaimApproved");
        expect(getTaskNoticeAction("task_claim_submitted", claimNoticeContent, storedTask(), ORGANISER)).toEqual({
            needed: false,
        });
        // The claimant's own notice now asks them to confirm.
        expect(getTaskNoticeAction("task_claim_approved", assigneeNoticeContent, storedTask(), CLAIMANT)).toEqual({
            needed: true,
        });
    });

    test("someone without the right to assign (a Crew member) is refused; nothing changes", async () => {
        sessionDid = OTHER_MEMBER;
        const before = snapshot();
        const result = await reviewTaskClaimAction("artist", TASK_ID, "claim-1", "approved");

        expect(result).toEqual({ success: false, message: "Not authorized to review task claims" });
        expect(snapshot()).toBe(before);
    });

    test("already handled elsewhere: refused with a message, nothing changes", async () => {
        sessionDid = ORGANISER;
        await reviewTaskClaimAction("artist", TASK_ID, "claim-1", "declined");
        const before = snapshot();
        const again = await reviewTaskClaimAction("artist", TASK_ID, "claim-1", "approved");

        expect(again).toEqual({ success: false, message: "Pending claim not found" });
        expect(snapshot()).toBe(before);
    });
});

describe("Accept from an assignment notice", () => {
    beforeEach(() => seed({ assignedTo: CLAIMANT, claimApprovedAt: past, claimApprovedBy: ORGANISER }));

    test("the assignee accepts; the notice then clears", async () => {
        expect(getTaskNoticeAction("task_assigned", assigneeNoticeContent, storedTask(), CLAIMANT)).toEqual({
            needed: true,
        });

        sessionDid = CLAIMANT;
        const result = await acceptTaskAction("artist", TASK_ID);

        expect(result.success).toBe(true);
        expect(storedTask().acceptedBy).toBe(CLAIMANT);
        expect(getTaskNoticeAction("task_assigned", assigneeNoticeContent, storedTask(), CLAIMANT)).toEqual({
            needed: false,
        });
    });

    test("anyone else, even the organiser, is refused; nothing changes", async () => {
        for (const did of [OTHER_MEMBER, ORGANISER]) {
            sessionDid = did;
            const before = snapshot();
            const result = await acceptTaskAction("artist", TASK_ID);

            expect(result).toEqual({ success: false, message: "Only the assignee can accept this task" });
            expect(snapshot()).toBe(before);
        }
    });

    test("signed out: refused", async () => {
        const result = await acceptTaskAction("artist", TASK_ID);
        expect(result.success).toBe(false);
        expect(storedTask().acceptedBy).toBeUndefined();
    });
});
