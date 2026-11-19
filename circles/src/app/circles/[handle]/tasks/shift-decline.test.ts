// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/shift-decline.test.ts"
// Crew round 2, commit 4 (2026-11-18), decisions F1 and F4:
// - F1: an organiser (tasks.assign or tasks.moderate, as for confirming; Assign added 2026-11-19,
//   Tim's option (a)) can decline a PENDING shift sign-up. The entry
//   is removed (so the person can offer again if a place opens), and only that person gets a bell
//   notice (task_shift_declined). Confirmed people can't be declined. Only through the task's own
//   circle, as for every task action since 2026-11-16.
// - F4: approving one task claim closes the other pending claims; those claimants now get the existing
//   task_claim_declined notice (before: nothing). The same when a task is assigned directly (Tim,
//   2026-11-18), except to the new assignee.
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

    test("refused without tasks.assign or tasks.moderate (a crew member, signed out)", async () => {
        for (const did of [C1, undefined]) {
            seed(shift([pending(C2)]));
            sessionDid = did;
            const before = snapshot();
            const result = await actions.declineShiftParticipantAction("y", TASK_ID, C2);
            expect(result.success).toBe(false);
            expect(snapshot()).toBe(before);
        }
        expect(notices).toEqual([]);
    });

    // Option (a) (Tim, 2026-11-19): Assign Tasks can confirm and decline sign-ups. Attendance,
    // editing and deleting stay with Moderate Tasks.
    test("Assign Tasks only (a moderator by default): can decline", async () => {
        seed(shift([pending(C2)]));
        sessionDid = MODERATOR_Y;
        const result = await actions.declineShiftParticipantAction("y", TASK_ID, C2);
        expect(result.success).toBe(true);
        expect(dids()).toEqual([]);
        expect(notices).toEqual([{ type: "task_shift_declined", to: C2 }]);
    });

    test("Assign Tasks only: can confirm", async () => {
        seed(shift([pending(C2)]));
        sessionDid = MODERATOR_Y;
        const result = await actions.verifyShiftParticipantAction("y", TASK_ID, C2);
        expect(result.success).toBe(true);
        const entry = (stored().participants as { userDid: string; verifiedAt?: Date; verifiedBy?: string }[])[0];
        expect(Boolean(entry.verifiedAt)).toBe(true);
        expect(entry.verifiedBy).toBe(MODERATOR_Y);
    });

    test("Assign Tasks only: attendance and deleting are still refused", async () => {
        seed({
            ...shift([confirmed(C2)]),
            targetDate: new Date("2026-01-10T00:00:00Z"), // long over
        });
        sessionDid = MODERATOR_Y;
        const before = snapshot();
        const attendance = await actions.reviewShiftAttendanceAction("y", TASK_ID, C2, "attended");
        expect(attendance.success).toBe(false);
        const deleted = await actions.deleteTaskAction("y", TASK_ID);
        expect(deleted.success).toBe(false);
        expect(snapshot()).toBe(before);
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
        expect(body).toBe(
            "Thanks for offering to help with Door shift. All places are filled this time, and we hope to see you on another one.",
        );
    });
});

describe("a pending entry stored with verifiedAt: null still counts as pending", () => {
    // No code path writes null today (audit, 2026-11-18), but the driver stores undefined as null, so
    // older data could have it. Confirm, decline and leave match "verifiedAt is null or missing".
    const nullPending = (userDid: string) => ({ userDid, joinedAt: joined, verifiedAt: null });

    test("it can be confirmed", async () => {
        seed(shift([nullPending(C2)]));
        expect((await actions.verifyShiftParticipantAction("y", TASK_ID, C2)).success).toBe(true);
        expect((stored().participants as { verifiedAt?: Date }[])[0].verifiedAt instanceof Date).toBe(true);
    });

    test("it can be declined", async () => {
        seed(shift([confirmed(C1), nullPending(C2)]));
        expect((await actions.declineShiftParticipantAction("y", TASK_ID, C2)).success).toBe(true);
        expect(dids()).toEqual([C1]);
    });

    test("the person can leave", async () => {
        seed(shift([confirmed(C1), nullPending(C2)]));
        sessionDid = C2;
        expect((await actions.leaveShiftTaskAction("y", TASK_ID)).success).toBe(true);
        expect(dids()).toEqual([C1]);
    });

    test("it doesn't count towards the confirm cap", async () => {
        seed(shift([confirmed(C1), nullPending(C2), pending(C3)]));
        expect((await actions.verifyShiftParticipantAction("y", TASK_ID, C3)).success).toBe(true);
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

    const assignForm = (did: string) => {
        const form = new FormData();
        form.set("assigneeDid", did);
        return form;
    };

    test("direct assignment to C3 (no claim): C1 and C2 told their pending claims are declined", async () => {
        seed({
            title: "Bring a PA",
            taskType: "outcome",
            stage: "open",
            claims: [claim("k1", C1), claim("k2", C2), claim("k0", "did:test:earlier", "declined")],
        });
        const result = await actions.assignTaskAction("y", TASK_ID, assignForm(C3));
        expect(result.success).toBe(true);
        expect(stored().assignedTo).toBe(C3);
        const statuses = Object.fromEntries(
            (stored().claims as { claimId: string; status: string }[]).map((c) => [c.claimId, c.status]),
        );
        expect(statuses).toEqual({ k1: "closed", k2: "closed", k0: "declined" });
        expect(notices).toEqual([
            { type: "task_claim_declined", to: C1 },
            { type: "task_claim_declined", to: C2 },
        ]);
    });

    test("direct assignment to C1, who had a pending claim: only C2 is told 'declined'", async () => {
        seed({ title: "Bring a PA", taskType: "outcome", stage: "open", claims: [claim("k1", C1), claim("k2", C2)] });
        expect((await actions.assignTaskAction("y", TASK_ID, assignForm(C1))).success).toBe(true);
        expect(notices).toEqual([{ type: "task_claim_declined", to: C2 }]);
    });

    test("declining one claim still notifies that claimant only", async () => {
        seed({ title: "Bring a PA", taskType: "outcome", stage: "open", claims: [claim("k1", C1), claim("k2", C2)] });
        expect((await actions.reviewTaskClaimAction("y", TASK_ID, "k2", "declined")).success).toBe(true);
        expect(notices).toEqual([{ type: "task_claim_declined", to: C2 }]);
    });
});
