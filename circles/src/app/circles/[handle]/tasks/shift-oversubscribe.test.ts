// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/shift-oversubscribe.test.ts"
// Crew round 2, commit 2 (2026-11-18): more sign-ups than places while places aren't all confirmed.
// joinShiftTaskAction used to refuse at participants.length >= slots (pending included). Now:
// - a sign-up is refused only when confirmed >= slots ("All places are confirmed");
// - F5: total sign-ups stop at 3 × places, at least 10 ("Many people have already offered");
// - the write carries both conditions, so a sign-up racing the last confirm can't slip in;
// - updateTaskAction: places can't go below the CONFIRMED count (pending may exceed places).
// The database is in-memory fakes; the session, permissions and notifications are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_ID = "64f800000000000000000022";
const TASK_ID = "64f8000000000000000000d1";
const ORGANISER = "did:test:organiser";
const NEWCOMER = "did:test:newcomer";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, _circleId: string, feature: unknown) => {
        if (feature === features.tasks.view) return true;
        return did === ORGANISER;
    },
}));
mock.module("@/lib/auth/verification", () => ({
    canPerformRestrictedAction: () => true,
    getRestrictedActionMessage: (action: string) => `You can't ${action} yet.`,
}));
const realNotifications = await import("@/lib/data/notifications");
mock.module("@/lib/data/notifications", () =>
    Object.fromEntries(
        Object.entries(realNotifications).map(([name, value]) => [
            name,
            name.startsWith("notify") ? async () => undefined : value,
        ]),
    ),
);
const realUser = await import("@/lib/data/user");
mock.module("@/lib/data/user", () => ({
    ...realUser,
    getUserByDid: async (did: string) => ({ did, handle: did.split(":").pop(), name: did, circleType: "user" }),
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

const { joinShiftTaskAction, updateTaskAction } = await import("./actions");

const joined = new Date("2026-11-10T10:00:00Z");
type Participant = { userDid: string; joinedAt: Date; verifiedAt?: Date; verifiedBy?: string };
const pending = (n: number, from = 0): Participant[] =>
    Array.from({ length: n }, (_, i) => ({ userDid: `did:test:p${from + i}`, joinedAt: joined }));
const confirmed = (n: number): Participant[] =>
    Array.from({ length: n }, (_, i) => ({
        userDid: `did:test:c${i}`,
        joinedAt: joined,
        verifiedAt: joined,
        verifiedBy: ORGANISER,
    }));

const shift = (slots: number, participants: Participant[]) => ({
    _id: new ObjectId(TASK_ID),
    circleId: CIRCLE_ID,
    createdBy: ORGANISER,
    title: "Door shift",
    description: "Welcome guests",
    taskType: "shift",
    stage: "open",
    userGroups: ["everyone"],
    slots,
    shiftStartTime: "18:00",
    shiftDurationMinutes: 120,
    targetDate: new Date("2027-01-10T00:00:00Z"),
    participants,
});

// `read`: what getTaskById sees, when it should differ from the stored document (a read made before
// someone else's write landed).
const seed = (stored: ReturnType<typeof shift>, read?: ReturnType<typeof shift>) => {
    fakeDb.reset({
        Circles: [{ _id: new ObjectId(CIRCLE_ID), did: "did:test:y", handle: "y", circleType: "circle" }],
        Tasks: [stored],
    });
    fakeDb.setAggregateResult("Tasks", read ? [read] : fakeDb.col("Tasks").docs, { applyLeadingMatch: true });
};
const stored = () => fakeDb.col("Tasks").docs[0] as ReturnType<typeof shift>;
const dids = () => stored().participants.map((p) => p.userDid);

beforeEach(() => {
    sessionDid = NEWCOMER;
});

describe("sign-up counts confirmed people only", () => {
    test("2 places with 3 pending: a 4th person can still sign up (pending)", async () => {
        seed(shift(2, pending(3)));
        const result = await joinShiftTaskAction("y", TASK_ID);
        expect(result.success).toBe(true);
        expect(dids()).toContain(NEWCOMER);
        expect(stored().participants.find((p) => p.userDid === NEWCOMER)?.verifiedAt).toBeUndefined();
    });

    test("2 places with 1 confirmed and 2 pending: sign-up still works", async () => {
        seed(shift(2, [...confirmed(1), ...pending(2)]));
        expect((await joinShiftTaskAction("y", TASK_ID)).success).toBe(true);
    });

    test("2 places, 2 confirmed: the next sign-up is refused and nothing is written", async () => {
        seed(shift(2, [...confirmed(2), ...pending(1)]));
        const before = JSON.stringify(fakeDb.col("Tasks").docs);
        const result = await joinShiftTaskAction("y", TASK_ID);
        expect(result).toEqual({ success: false, message: "All places are confirmed" });
        expect(JSON.stringify(fakeDb.col("Tasks").docs)).toBe(before);
    });

    test("the write checks too: a sign-up read before the last confirm landed is refused", async () => {
        seed(shift(2, [...confirmed(2), ...pending(1)]), shift(2, [...confirmed(1), ...pending(2)]));
        const before = JSON.stringify(fakeDb.col("Tasks").docs);
        const result = await joinShiftTaskAction("y", TASK_ID);
        expect(result).toEqual({ success: false, message: "All places are confirmed" });
        expect(JSON.stringify(fakeDb.col("Tasks").docs)).toBe(before);
    });

    test("signing up twice is still refused", async () => {
        seed(shift(2, [{ userDid: NEWCOMER, joinedAt: joined }]));
        const result = await joinShiftTaskAction("y", TASK_ID);
        expect(result.success).toBe(false);
        expect(dids()).toEqual([NEWCOMER]);
    });
});

describe("F5: a ceiling of 3 × places, at least 10", () => {
    test("2 places: the 10th sign-up is accepted, the 11th refused", async () => {
        seed(shift(2, pending(9)));
        expect((await joinShiftTaskAction("y", TASK_ID)).success).toBe(true);
        expect(dids()).toHaveLength(10);

        sessionDid = "did:test:eleventh";
        const before = JSON.stringify(fakeDb.col("Tasks").docs);
        const result = await joinShiftTaskAction("y", TASK_ID);
        expect(result).toEqual({ success: false, message: "Many people have already offered for this shift" });
        expect(JSON.stringify(fakeDb.col("Tasks").docs)).toBe(before);
    });

    test("5 places: the ceiling is 15 (confirmed people count towards it)", async () => {
        seed(shift(5, [...confirmed(2), ...pending(12)]));
        expect((await joinShiftTaskAction("y", TASK_ID)).success).toBe(true);
        sessionDid = "did:test:sixteenth";
        expect((await joinShiftTaskAction("y", TASK_ID)).message).toBe(
            "Many people have already offered for this shift",
        );
        expect(dids()).toHaveLength(15);
    });

    test("the write checks the ceiling too: a read made before others signed up can't pass it", async () => {
        seed(shift(2, pending(10)), shift(2, pending(9)));
        const before = JSON.stringify(fakeDb.col("Tasks").docs);
        const result = await joinShiftTaskAction("y", TASK_ID);
        expect(result).toEqual({ success: false, message: "Many people have already offered for this shift" });
        expect(JSON.stringify(fakeDb.col("Tasks").docs)).toBe(before);
    });
});

describe("editing places: never below the confirmed count", () => {
    const editForm = (slots: number) => {
        const form = new FormData();
        const values: Record<string, string> = {
            title: "Door shift",
            description: "Welcome guests",
            taskType: "shift",
            slots: String(slots),
            shiftStartTime: "18:00",
            shiftDurationMinutes: "120",
            targetDate: "2027-01-10T00:00:00.000Z",
        };
        for (const [key, value] of Object.entries(values)) form.append(key, value);
        return form;
    };

    beforeEach(() => {
        sessionDid = ORGANISER;
    });

    test("2 confirmed: lowering places to 1 is refused, raising to 3 is accepted", async () => {
        seed(shift(2, [...confirmed(2), ...pending(1)]));
        const lowered = await updateTaskAction("y", TASK_ID, editForm(1));
        expect(lowered.success).toBe(false);
        expect(lowered.message).toBe("Places can't be fewer than the people already confirmed");
        expect(stored().slots).toBe(2);

        const raised = await updateTaskAction("y", TASK_ID, editForm(3));
        expect(raised.success).toBe(true);
        expect(stored().slots).toBe(3);
    });

    test("1 confirmed and 3 pending: lowering places to 1 (below the pending count) is allowed", async () => {
        seed(shift(3, [...confirmed(1), ...pending(3)]));
        const result = await updateTaskAction("y", TASK_ID, editForm(1));
        expect(result.success).toBe(true);
        expect(stored().slots).toBe(1);
        expect(stored().participants).toHaveLength(4);
    });
});
