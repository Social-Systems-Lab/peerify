// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/task-edit-keeps-links.test.ts"
// Crew R1, item 1 (2026-11-14): editing a task or shift silently unlinked it from its event and
// goal, and wiped its audience.
// - SAFE_TASK_PROJECTION had no eventId/goalId, so the edit form started with no event, sent an
//   empty id, and updateTask $unset it;
// - `userGroups: data.userGroups || task.userGroups` kept an empty list ([] is truthy), and an empty
//   audience means "everyone" (canViewerAccessTaskUserGroups).
// The database is in-memory fakes; the session and permission checks are stubbed.

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

const { updateTaskAction } = await import("./actions");
const { SAFE_TASK_PROJECTION } = await import("@/lib/data/task");

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

const stored = () => fakeDb.col("Tasks").docs[0];

describe("the edit form gets the task's own event and goal", () => {
    test("SAFE_TASK_PROJECTION includes eventId and goalId", () => {
        const projection: Record<string, unknown> = SAFE_TASK_PROJECTION;
        expect(projection.eventId).toBe(1);
        expect(projection.goalId).toBe(1);
    });
});

describe("editing keeps the audience", () => {
    test("a form without an audience leaves a crew-only shift crew-only", async () => {
        const result = await updateTaskAction("host", TASK_ID, editForm());
        expect(result.success).toBe(true);
        expect(stored().title).toBe("Door (updated)");
        expect(stored().userGroups).toEqual(CREW_ONLY);
    });

    test("an empty audience never turns a shift into 'everyone'", async () => {
        const form = editForm();
        form.append("userGroups", "");
        await updateTaskAction("host", TASK_ID, form);
        expect(stored().userGroups).toEqual(CREW_ONLY);
    });

    test("a form that sends an audience still changes it", async () => {
        const form = editForm();
        form.append("userGroups", "everyone");
        await updateTaskAction("host", TASK_ID, form);
        expect(stored().userGroups).toEqual(["everyone"]);
    });

    test("the event and goal stay linked when the form sends them", async () => {
        await updateTaskAction("host", TASK_ID, editForm());
        expect(stored().eventId).toBe(EVENT_ID);
        expect(stored().goalId).toBe(GOAL_ID);
    });
});
