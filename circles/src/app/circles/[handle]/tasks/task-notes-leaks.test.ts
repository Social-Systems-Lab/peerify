// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/task-notes-leaks.test.ts"
// Leak round 3, M5 (the part that changes no default, 2026-11-07):
// - A claim's note and a participant's attendance note went to everyone who could view the task
//   (SAFE_TASK_PROJECTION), though the app shows them only to the people who act on them
//   (tasks.assign: claims; tasks.moderate: attendance) and to the person concerned.
// - Tasks linked to an event (getTasksByEventAction) and the ranking list (getTasksForRankingAction)
//   skipped filterTasksForViewer, so a task's audience (userGroups) wasn't applied there.
// Exact task/shift locations, the shift's "Important for participants" note and the
// changes-requested note are Tim's decision (they would change what visitors see) and are not
// changed here. The database is in-memory fakes; the session and permission checks are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_ID = "64f200000000000000000001";
const TASK_ID = "64f2000000000000000000a1";
const CREW_TASK_ID = "64f2000000000000000000a2";
const ASSIGNER = "did:test:assigner";
const MODERATOR = "did:test:moderator";
const CLAIMANT = "did:test:claimant";
const PARTICIPANT = "did:test:participant";
const STRANGER = "did:test:stranger";

const CLAIM_NOTE = "CANARY CLAIM NOTE: my phone is 070-000";
const ATTENDANCE_NOTE = "CANARY ATTENDANCE NOTE: left early, unwell";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, _circleId: string, feature: unknown) => {
        if (feature === features.tasks.view || feature === features.events.view || feature === features.tasks.rank) {
            return true;
        }
        if (feature === features.tasks.assign) return did === ASSIGNER;
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

const { getTaskAction, getTasksForRankingAction } = await import("./actions");
const { getTasksByEventAction } = await import("../events/actions");

const task = (id: string, extra: Record<string, unknown> = {}) => ({
    _id: id,
    circleId: CIRCLE_ID,
    createdBy: ASSIGNER,
    title: "Load the van",
    stage: "open",
    userGroups: ["everyone"],
    claims: [{ claimantDid: CLAIMANT, status: "pending", note: CLAIM_NOTE, createdAt: new Date() }],
    participants: [{ userDid: PARTICIPANT, attendanceStatus: "left_early", attendanceNote: ATTENDANCE_NOTE }],
    ...extra,
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [{ _id: new ObjectId(CIRCLE_ID), did: "did:test:band", handle: "band", name: "Band", circleType: "circle" }],
        Members: [{ userDid: "did:test:crew", circleId: CIRCLE_ID, userGroups: ["members", "crew"] }],
    });
    fakeDb.setAggregateResult("Tasks", [task(TASK_ID)]);
});

const text = (value: unknown) => JSON.stringify(value) ?? "";

describe("task notes (getTaskAction)", () => {
    test("a signed-in stranger: neither note", async () => {
        sessionDid = STRANGER;
        const t = await getTaskAction("band", TASK_ID);
        expect(t?.title).toBe("Load the van");
        expect(text(t)).not.toContain(CLAIM_NOTE);
        expect(text(t)).not.toContain(ATTENDANCE_NOTE);
        expect(t?.claims?.[0]?.claimantDid).toBe(CLAIMANT); // the claim itself stays
    });

    test("the claimant sees their own claim note, not someone's attendance note", async () => {
        sessionDid = CLAIMANT;
        const t = await getTaskAction("band", TASK_ID);
        expect(t?.claims?.[0]?.note).toBe(CLAIM_NOTE);
        expect(text(t)).not.toContain(ATTENDANCE_NOTE);
    });

    test("the participant sees their own attendance note, not the claim note", async () => {
        sessionDid = PARTICIPANT;
        const t = await getTaskAction("band", TASK_ID);
        expect(t?.participants?.[0]?.attendanceNote).toBe(ATTENDANCE_NOTE);
        expect(text(t)).not.toContain(CLAIM_NOTE);
    });

    test("people with assign or moderate still see both", async () => {
        for (const did of [ASSIGNER, MODERATOR]) {
            sessionDid = did;
            const t = text(await getTaskAction("band", TASK_ID));
            expect(t).toContain(CLAIM_NOTE);
            expect(t).toContain(ATTENDANCE_NOTE);
        }
    });
});

describe("tasks linked to an event, and the ranking list", () => {
    beforeEach(() => {
        fakeDb.setAggregateResult("Tasks", [
            task(TASK_ID),
            task(CREW_TASK_ID, { title: "CANARY CREW-ONLY TASK", userGroups: ["crew"] }),
        ]);
    });

    test("a signed-in stranger: no crew-only task, no notes", async () => {
        sessionDid = STRANGER;
        for (const tasks of [(await getTasksByEventAction("band", "64f2000000000000000000e1")).tasks, await getTasksForRankingAction("band")]) {
            expect(tasks.map((t) => t.title)).toEqual(["Load the van"]);
            expect(text(tasks)).not.toContain(CLAIM_NOTE);
            expect(text(tasks)).not.toContain(ATTENDANCE_NOTE);
        }
    });

    test("a crew member gets the crew-only task", async () => {
        sessionDid = "did:test:crew";
        const { tasks } = await getTasksByEventAction("band", "64f2000000000000000000e1");
        expect(tasks.map((t) => t.title).sort()).toEqual(["CANARY CREW-ONLY TASK", "Load the van"]);
    });
});
