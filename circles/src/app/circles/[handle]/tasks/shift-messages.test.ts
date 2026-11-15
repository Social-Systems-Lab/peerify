// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/shift-messages.test.ts"
// Crew polish, item 1 (Tim, 2026-11-15): saving a shift showed "Task updated successfully". The form
// shows the server's message as the toast text, so the server now words shift messages as shifts.
// Tasks keep their wording. The database is in-memory fakes; the session and permissions are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_ID = "64f800000000000000000001";
const TASK_ID = "64f8000000000000000000b1";
const EVENT_ID = "64f8000000000000000000e1";
const GOAL_ID = "64f8000000000000000000c1";
const AUTHOR = "did:test:author";
const MODERATOR = "did:test:moderator";
const CREW_ONLY = ["admins", "moderators", "crew"];

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, _circleId: string, feature: unknown) => {
        if (feature === features.tasks.view) return true;
        if (feature === features.tasks.moderate) return did === MODERATOR;
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCircleByHandle: async (handle: string) => fakeDb.col("Circles").docs.find((c) => c.handle === handle) ?? null,
}));

const { updateTaskAction, deleteTaskAction } = await import("./actions");

const storedShift = () => ({
    _id: new ObjectId(TASK_ID),
    circleId: CIRCLE_ID,
    createdBy: AUTHOR,
    taskType: "shift",
    title: "Door",
    description: "Welcome guests",
    stage: "open",
    userGroups: CREW_ONLY,
    eventId: EVENT_ID,
    goalId: GOAL_ID,
    slots: 2,
    shiftStartTime: "18:00",
    shiftDurationMinutes: 120,
    targetDate: new Date("2026-12-05T00:00:00Z"),
    participants: [],
});

beforeEach(() => {
    sessionDid = MODERATOR;
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(CIRCLE_ID), did: "did:test:host", handle: "host", name: "Host", circleType: "circle" },
        ],
        Tasks: [storedShift()],
    });
    fakeDb.setAggregateResult("Tasks", [{ ...storedShift(), _id: TASK_ID }]);
});

// What the edit form sends for a shift today: no userGroups field at all.
const editForm = (fields: Record<string, string> = {}) => {
    const form = new FormData();
    const values: Record<string, string> = {
        title: "Door (updated)",
        description: "Welcome guests",
        taskType: "shift",
        slots: "2",
        shiftStartTime: "18:00",
        shiftDurationMinutes: "120",
        targetDate: "2026-12-05T00:00:00.000Z",
        eventId: EVENT_ID,
        goalId: GOAL_ID,
        ...fields,
    };
    for (const [key, value] of Object.entries(values)) form.append(key, value);
    return form;
};

const useTask = () => {
    const task = { ...storedShift(), taskType: "outcome", slots: undefined, participants: undefined };
    fakeDb.reset({
        Circles: fakeDb.col("Circles").docs,
        Tasks: [task],
    });
    fakeDb.setAggregateResult("Tasks", [{ ...task, _id: TASK_ID }]);
};

describe("shift messages say 'shift'", () => {
    test("saving a shift: 'Shift updated'", async () => {
        const result = await updateTaskAction("host", TASK_ID, editForm());
        expect(result.success).toBe(true);
        expect(result.message).toBe("Shift updated");
    });

    test("deleting a shift: 'Shift deleted'", async () => {
        const result = await deleteTaskAction("host", TASK_ID);
        expect(result.success).toBe(true);
        expect(result.message).toBe("Shift deleted");
    });

    test("a shift without a date: 'Date is required for shifts'", async () => {
        const form = editForm();
        form.set("targetDate", "");
        const result = await updateTaskAction("host", TASK_ID, form);
        expect(result.success).toBe(false);
        expect(result.message ?? "").not.toContain("task");
    });
});

describe("task messages are unchanged", () => {
    test("saving a task: 'Task updated successfully'", async () => {
        useTask();
        const form = editForm({ taskType: "outcome" });
        for (const key of ["slots", "shiftStartTime", "shiftDurationMinutes"]) form.delete(key);
        const result = await updateTaskAction("host", TASK_ID, form);
        expect(result.success).toBe(true);
        expect(result.message).toBe("Task updated successfully");
    });

    test("deleting a task: 'Task deleted successfully'", async () => {
        useTask();
        const result = await deleteTaskAction("host", TASK_ID);
        expect(result.success).toBe(true);
        expect(result.message).toBe("Task deleted successfully");
    });
});
