// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/shift-edit-race.test.ts"
// Crew round 2 (2026-11-18): saving the shift edit form wrote back `participants` as read at the start
// of updateTaskAction, so a sign-up, confirm or decline landing between that read and the save was
// lost. The edit form never changes participants, so the edit no longer writes them.
// The database is in-memory fakes; the session and permissions are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_ID = "64f800000000000000000022";
const TASK_ID = "64f8000000000000000000d1";
const ORGANISER = "did:test:organiser";
const C1 = "did:test:c1";
const C2 = "did:test:c2";

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
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCircleByHandle: async (handle: string) => {
        const circle = fakeDb.col("Circles").docs.find((c) => c.handle === handle);
        return circle ? { ...circle, _id: circle._id.toString() } : null;
    },
}));

const { updateTaskAction } = await import("./actions");

const joined = new Date("2026-11-10T10:00:00Z");
const shift = (participants: Record<string, unknown>[]) => ({
    _id: new ObjectId(TASK_ID),
    circleId: CIRCLE_ID,
    createdBy: ORGANISER,
    title: "Door shift",
    description: "Welcome guests",
    taskType: "shift",
    stage: "open",
    userGroups: ["everyone"],
    slots: 2,
    shiftStartTime: "18:00",
    shiftDurationMinutes: 120,
    targetDate: new Date("2027-01-10T00:00:00Z"),
    participants,
});

const editForm = (fields: Record<string, string> = {}) => {
    const form = new FormData();
    const values: Record<string, string> = {
        title: "Door shift (updated)",
        description: "Welcome guests",
        taskType: "shift",
        slots: "3",
        shiftStartTime: "18:00",
        shiftDurationMinutes: "120",
        targetDate: "2027-01-10T00:00:00.000Z",
        ...fields,
    };
    for (const [key, value] of Object.entries(values)) form.append(key, value);
    return form;
};

beforeEach(() => {
    sessionDid = ORGANISER;
});

describe("editing a shift keeps sign-ups that landed meanwhile", () => {
    test("the edit read [C1]; C2 signed up before the save: both are still there, and the edit applied", async () => {
        const stored = shift([
            { userDid: C1, joinedAt: joined },
            { userDid: C2, joinedAt: joined },
        ]);
        const readBeforeC2 = shift([{ userDid: C1, joinedAt: joined }]);
        fakeDb.reset({
            Circles: [{ _id: new ObjectId(CIRCLE_ID), did: "did:test:y", handle: "y", circleType: "circle" }],
            Tasks: [stored],
        });
        fakeDb.setAggregateResult("Tasks", [readBeforeC2], { applyLeadingMatch: true });

        const result = await updateTaskAction("y", TASK_ID, editForm());
        expect(result.success).toBe(true);
        const after = fakeDb.col("Tasks").docs[0];
        expect(after.title).toBe("Door shift (updated)");
        expect(after.slots).toBe(3);
        expect((after.participants as { userDid: string }[]).map((p) => p.userDid)).toEqual([C1, C2]);
    });

    test("a confirm that landed meanwhile isn't undone by the save", async () => {
        const stored = shift([{ userDid: C1, joinedAt: joined, verifiedAt: joined, verifiedBy: ORGANISER }]);
        const readBeforeConfirm = shift([{ userDid: C1, joinedAt: joined }]);
        fakeDb.reset({
            Circles: [{ _id: new ObjectId(CIRCLE_ID), did: "did:test:y", handle: "y", circleType: "circle" }],
            Tasks: [stored],
        });
        fakeDb.setAggregateResult("Tasks", [readBeforeConfirm], { applyLeadingMatch: true });

        expect((await updateTaskAction("y", TASK_ID, editForm())).success).toBe(true);
        const after = fakeDb.col("Tasks").docs[0];
        expect((after.participants as { verifiedAt?: Date }[])[0].verifiedAt).toEqual(joined);
    });
});
