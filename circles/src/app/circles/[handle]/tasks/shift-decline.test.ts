// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/shift-decline.test.ts"
// Crew round 2, commit 4 (2026-11-18), decisions F1 and F4:
// - F1: an organiser (tasks.moderate, as for confirming) can decline a PENDING shift sign-up. The entry
//   is removed (so the person can offer again if a place opens), and only that person gets a bell
//   notice (task_shift_declined). Confirmed people can't be declined. Only through the task's own
//   circle, as for every task action since 2026-11-16.
// - F4: approving one task claim closes the other pending claims; those claimants now get the existing
//   task_claim_declined notice (before: nothing).
// The database is in-memory fakes; the session and permissions are stubbed; notifications are
// recorded instead of sent.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const X_ID = "64f800000000000000000011"; // another circle; ADMIN_X is its admin
const Y_ID = "64f800000000000000000022"; // the task's circle
const TASK_ID = "64f8000000000000000000d1";
const ADMIN_Y = "did:test:admin-y";
const MODERATOR_Y = "did:test:moderator-y"; // tasks.assign only (the default for moderators)
const ADMIN_X = "did:test:admin-x";
const C1 = "did:test:c1";
const C2 = "did:test:c2";
const C3 = "did:test:c3";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) => {
        if (feature === features.tasks.view) return true;
        const isAdmin = (did === ADMIN_Y && circleId === Y_ID) || (did === ADMIN_X && circleId === X_ID);
        if (feature === features.tasks.assign) return isAdmin || (did === MODERATOR_Y && circleId === Y_ID);
        return isAdmin;
    },
}));
mock.module("@/lib/auth/verification", () => ({
    canPerformRestrictedAction: () => true,
    getRestrictedActionMessage: (action: string) => `You can't ${action} yet.`,
}));

type Notice = { type: string; to: string };
const notices: Notice[] = [];
const realNotifications = await import("@/lib/data/notifications");
mock.module("@/lib/data/notifications", () => ({
    ...Object.fromEntries(
        Object.entries(realNotifications).map(([name, value]) => [
            name,
            name.startsWith("notify") ? async () => undefined : value,
        ]),
    ),
    notifyTaskShiftDeclined: async (_task: unknown, _decliner: unknown, participant: { did: string }) => {
        notices.push({ type: "task_shift_declined", to: participant.did });
    },
    notifyTaskClaimApproved: async (_task: unknown, _reviewer: unknown, claimant: { did: string }) => {
        notices.push({ type: "task_claim_approved", to: claimant.did });
    },
    notifyTaskClaimDeclined: async (_task: unknown, _reviewer: unknown, claimant: { did: string }) => {
        notices.push({ type: "task_claim_declined", to: claimant.did });
    },
}));
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

const actions = await import("./actions");
const { buildNotificationBody } = realNotifications;

const joined = new Date("2026-11-10T10:00:00Z");
const pending = (userDid: string) => ({ userDid, joinedAt: joined });
const confirmed = (userDid: string) => ({ userDid, joinedAt: joined, verifiedAt: joined, verifiedBy: ADMIN_Y });

const member = (userDid: string, circleId: string, userGroups: string[]) => ({
    _id: new ObjectId(),
    circleId,
    userDid,
    userGroups,
});

const seed = (task: Record<string, unknown>) => {
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(X_ID), did: "did:test:x", handle: "x", circleType: "circle" },
            { _id: new ObjectId(Y_ID), did: "did:test:y", handle: "y", circleType: "circle" },
        ],
        Members: [
            member(ADMIN_Y, Y_ID, ["admins", "members"]),
            member(MODERATOR_Y, Y_ID, ["moderators", "members"]),
            member(ADMIN_X, X_ID, ["admins", "members"]),
            member(ADMIN_X, Y_ID, ["members"]),
            ...[C1, C2, C3].map((did) => member(did, Y_ID, ["crew", "members"])),
        ],
        Tasks: [{ _id: new ObjectId(TASK_ID), circleId: Y_ID, createdBy: ADMIN_Y, userGroups: ["everyone"], ...task }],
    });
    fakeDb.setAggregateResult("Tasks", fakeDb.col("Tasks").docs, { applyLeadingMatch: true });
};
const shift = (participants: Record<string, unknown>[], slots = 2) => ({
    title: "Door shift",
    taskType: "shift",
    stage: "open",
    slots,
    shiftStartTime: "18:00",
    shiftDurationMinutes: 120,
    targetDate: new Date("2027-01-10T00:00:00Z"),
    participants,
});
const stored = () => fakeDb.col("Tasks").docs[0];
const dids = () => (stored().participants as { userDid: string }[]).map((p) => p.userDid);
const snapshot = () => JSON.stringify(fakeDb.col("Tasks").docs);

beforeEach(() => {
    sessionDid = ADMIN_Y;
    notices.length = 0;
});

describe("F1: declining a pending shift sign-up", () => {
    test("the organiser declines C2: only C2's entry is removed, and only C2 is notified", async () => {
        seed(shift([confirmed(C1), pending(C2), pending(C3)]));
        const result = await actions.declineShiftParticipantAction("y", TASK_ID, C2);
        expect(result.success).toBe(true);
        expect(dids()).toEqual([C1, C3]);
        expect(notices).toEqual([{ type: "task_shift_declined", to: C2 }]);
    });

    test("a confirmed person can't be declined; nothing is written", async () => {
        seed(shift([confirmed(C1), pending(C2)]));
        const before = snapshot();
        const result = await actions.declineShiftParticipantAction("y", TASK_ID, C1);
        expect(result.success).toBe(false);
        expect(snapshot()).toBe(before);
        expect(notices).toEqual([]);
    });

    test("someone not on the shift: refused", async () => {
        seed(shift([pending(C2)]));
        const result = await actions.declineShiftParticipantAction("y", TASK_ID, C3);
        expect(result.success).toBe(false);
        expect(dids()).toEqual([C2]);
        expect(notices).toEqual([]);
    });

    test("refused without tasks.moderate (a moderator by default, a crew member)", async () => {
        for (const did of [MODERATOR_Y, C1, undefined]) {
            seed(shift([pending(C2)]));
            sessionDid = did;
            const before = snapshot();
            const result = await actions.declineShiftParticipantAction("y", TASK_ID, C2);
            expect(result.success).toBe(false);
            expect(snapshot()).toBe(before);
        }
        expect(notices).toEqual([]);
    });

    test("another circle's admin, through their own circle's handle: refused", async () => {
        seed(shift([pending(C2)]));
        sessionDid = ADMIN_X;
        const before = snapshot();
        const result = await actions.declineShiftParticipantAction("x", TASK_ID, C2);
        expect(result).toEqual({ success: false, message: "Task not found" });
        expect(snapshot()).toBe(before);
        expect(notices).toEqual([]);
    });

    test("a declined person can offer again", async () => {
        seed(shift([confirmed(C1), pending(C2)]));
        expect((await actions.declineShiftParticipantAction("y", TASK_ID, C2)).success).toBe(true);
        sessionDid = C2;
        expect((await actions.joinShiftTaskAction("y", TASK_ID)).success).toBe(true);
        expect(dids()).toEqual([C1, C2]);
    });

    test("not on a task (outcome)", async () => {
        seed({ title: "Bring a PA", taskType: "outcome", stage: "open" });
        const result = await actions.declineShiftParticipantAction("y", TASK_ID, C2);
        expect(result.success).toBe(false);
    });

    test("the notice thanks the person and names the shift, not the organiser", () => {
        const body = buildNotificationBody("task_shift_declined", {
            taskTitle: "Door shift",
            user: { name: "Organiser Name" },
        });
        expect(body).toContain("Door shift");
        expect(body).toContain("Thanks for offering");
        expect(body).not.toContain("Organiser Name");
    });
});

describe("leaving a shift removes only the person leaving", () => {
    test("C2 leaves: C1 and C3 stay", async () => {
        seed(shift([confirmed(C1), pending(C2), pending(C3)]));
        sessionDid = C2;
        expect((await actions.leaveShiftTaskAction("y", TASK_ID)).success).toBe(true);
        expect(dids()).toEqual([C1, C3]);
    });
});

describe("F4: claims closed when another is approved get a notice", () => {
    const claim = (claimId: string, claimantDid: string, status = "pending") => ({
        claimId,
        claimantDid,
        status,
        createdAt: joined,
    });

    test("approving C1's claim: C1 approved, C2 and C3 told their claims are declined, an older declined claim isn't told again", async () => {
        seed({
            title: "Bring a PA",
            taskType: "outcome",
            stage: "open",
            claims: [claim("k1", C1), claim("k2", C2), claim("k3", C3), claim("k0", "did:test:earlier", "declined")],
        });
        const result = await actions.reviewTaskClaimAction("y", TASK_ID, "k1", "approved");
        expect(result.success).toBe(true);
        expect(stored().assignedTo).toBe(C1);
        const statuses = Object.fromEntries(
            (stored().claims as { claimId: string; status: string }[]).map((c) => [c.claimId, c.status]),
        );
        expect(statuses).toEqual({ k1: "approved", k2: "closed", k3: "closed", k0: "declined" });
        expect(notices).toEqual([
            { type: "task_claim_approved", to: C1 },
            { type: "task_claim_declined", to: C2 },
            { type: "task_claim_declined", to: C3 },
        ]);
    });

    test("declining one claim still notifies that claimant only", async () => {
        seed({ title: "Bring a PA", taskType: "outcome", stage: "open", claims: [claim("k1", C1), claim("k2", C2)] });
        expect((await actions.reviewTaskClaimAction("y", TASK_ID, "k2", "declined")).success).toBe(true);
        expect(notices).toEqual([{ type: "task_claim_declined", to: C2 }]);
    });
});
