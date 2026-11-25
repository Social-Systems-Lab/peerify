// Run: IS_BUILD=true bun test src/lib/data/notification-action-state.test.ts
// Backlog item 3 (2026-11-25): whether a task notice still needs its recipient to act, worked out
// from the task as it is now each time the bell loads (not stored on the notice).
//  - task_claim_submitted: needed while the claimant's claim is pending; its claimId is returned
//    for the bell's Approve button (notices don't store one).
//  - task_assigned / task_claim_approved: needed while the task is open, assigned to the recipient
//    and not yet accepted.
// The last block runs listNotificationsForUser on in-memory fakes (testing/fake-db.ts).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import {
    getTaskIdsForActionNotices,
    getTaskNoticeAction,
    withTaskNoticeActions,
    type TaskActionFacts,
} from "./notification-action-state";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const TASK_ID = "64a000000000000000007001";
const ORGANISER = "did:test:organiser";
const CLAIMANT = "did:test:claimant";
const OTHER = "did:test:other";

const claimNotice = (claimantDid = CLAIMANT) => ({ user: { did: claimantDid, name: "C" }, taskId: TASK_ID });
const assigneeNotice = { user: { did: ORGANISER }, taskId: TASK_ID };
const task = (overrides: Partial<TaskActionFacts> = {}): TaskActionFacts => ({
    _id: TASK_ID,
    stage: "open",
    claims: [],
    ...overrides,
});
const pendingClaim = { claimId: "claim-1", claimantDid: CLAIMANT, status: "pending" };

describe("claim notice (to organisers)", () => {
    test("the claimant's claim is pending: needed, with its claimId", () => {
        const result = getTaskNoticeAction("task_claim_submitted", claimNotice(), task({ claims: [pendingClaim] }), ORGANISER);
        expect(result).toEqual({ needed: true, claimId: "claim-1" });
    });

    test("finds the claimant's own claim among others", () => {
        const claims = [
            { claimId: "claim-0", claimantDid: OTHER, status: "pending" },
            { claimId: "claim-old", claimantDid: CLAIMANT, status: "declined" },
            pendingClaim,
        ];
        expect(getTaskNoticeAction("task_claim_submitted", claimNotice(), task({ claims }), ORGANISER)).toEqual({
            needed: true,
            claimId: "claim-1",
        });
    });

    test("approved, declined or closed: not needed", () => {
        for (const status of ["approved", "declined", "closed"]) {
            const claims = [{ ...pendingClaim, status }];
            expect(getTaskNoticeAction("task_claim_submitted", claimNotice(), task({ claims }), ORGANISER)).toEqual({
                needed: false,
            });
        }
    });

    test("task assigned, not open, a shift, or gone: not needed", () => {
        const claims = [pendingClaim];
        const check = (t: TaskActionFacts | undefined) =>
            getTaskNoticeAction("task_claim_submitted", claimNotice(), t, ORGANISER);
        expect(check(task({ claims, assignedTo: OTHER }))).toEqual({ needed: false });
        expect(check(task({ claims, stage: "inProgress" }))).toEqual({ needed: false });
        expect(check(task({ claims, taskType: "shift" }))).toEqual({ needed: false });
        expect(check(undefined)).toEqual({ needed: false });
    });

    test("no claimant on the notice: not needed", () => {
        expect(
            getTaskNoticeAction("task_claim_submitted", { taskId: TASK_ID }, task({ claims: [pendingClaim] }), ORGANISER),
        ).toEqual({ needed: false });
    });
});

describe("assignment notices (to the assignee)", () => {
    for (const type of ["task_assigned", "task_claim_approved"]) {
        test(`${type}: assigned to me, open, not accepted: needed`, () => {
            expect(getTaskNoticeAction(type, assigneeNotice, task({ assignedTo: CLAIMANT }), CLAIMANT)).toEqual({
                needed: true,
            });
        });

        test(`${type}: accepted, reassigned, not open, or gone: not needed`, () => {
            const check = (t: TaskActionFacts | undefined) => getTaskNoticeAction(type, assigneeNotice, t, CLAIMANT);
            expect(check(task({ assignedTo: CLAIMANT, acceptedBy: CLAIMANT }))).toEqual({ needed: false });
            expect(check(task({ assignedTo: OTHER }))).toEqual({ needed: false });
            expect(check(task({ assignedTo: CLAIMANT, stage: "review" }))).toEqual({ needed: false });
            expect(check(undefined)).toEqual({ needed: false });
        });
    }
});

describe("other notices", () => {
    test("left alone", () => {
        for (const type of ["task_accepted", "task_claim_declined", "task_shift_signup", "crew_application", "post_like"]) {
            expect(getTaskNoticeAction(type, assigneeNotice, task({ assignedTo: CLAIMANT }), CLAIMANT)).toBeUndefined();
        }
    });

    test("only valid task ids of action notices are looked up, once each", () => {
        const ids = getTaskIdsForActionNotices([
            { type: "task_assigned", content: { taskId: TASK_ID } },
            { type: "task_claim_submitted", content: { taskId: TASK_ID } },
            { type: "task_accepted", content: { taskId: "64a000000000000000007999" } },
            { type: "task_claim_approved", content: { taskId: "not-an-id" } },
        ]);
        expect(ids).toEqual([TASK_ID]);
    });

    test("only taskAction is added; nothing from the task leaks into the notice", () => {
        const notices = [
            { type: "task_claim_submitted", content: claimNotice() },
            { type: "post_like", content: {} },
        ];
        const secretTask = { ...task({ claims: [{ ...pendingClaim, note: "my phone is 555" } as any] }), title: "T" };
        const [claim, like] = withTaskNoticeActions(notices, [secretTask], ORGANISER);
        expect(Object.keys(claim).sort()).toEqual(["content", "taskAction", "type"]);
        expect(claim.taskAction).toEqual({ needed: true, claimId: "claim-1" });
        expect(JSON.stringify(claim)).not.toContain("555");
        expect(like).toEqual(notices[1]);
    });
});

const { listNotificationsForUser } = await import("./notifications");

describe("listNotificationsForUser adds taskAction from the stored task", () => {
    beforeEach(() => {
        fakeDb.reset({
            Tasks: [
                {
                    _id: new ObjectId(TASK_ID),
                    title: "Carry chairs",
                    stage: "open",
                    taskType: "outcome",
                    claims: [{ ...pendingClaim, note: "private note" }],
                },
            ],
            Notifications: [
                {
                    _id: new ObjectId(),
                    userId: ORGANISER,
                    type: "task_claim_submitted",
                    content: claimNotice(),
                    isRead: false,
                    createdAt: new Date("2026-11-25T10:00:00Z"),
                },
                {
                    _id: new ObjectId(),
                    userId: ORGANISER,
                    type: "post_like",
                    content: {},
                    isRead: false,
                    createdAt: new Date("2026-11-25T09:00:00Z"),
                },
            ],
        });
    });

    test("pending claim: needed with its id; other notices unchanged; no task fields sent", async () => {
        const [claim, like] = (await listNotificationsForUser(ORGANISER, 50)) as any[];
        expect(claim.taskAction).toEqual({ needed: true, claimId: "claim-1" });
        expect(like.taskAction).toBeUndefined();
        expect(JSON.stringify(claim)).not.toContain("private note");
        expect(JSON.stringify(claim)).not.toContain("Carry chairs");
    });

    test("once the claim is approved elsewhere: not needed", async () => {
        fakeDb.col("Tasks").docs[0].claims[0].status = "approved";
        fakeDb.col("Tasks").docs[0].assignedTo = CLAIMANT;
        const [claim] = (await listNotificationsForUser(ORGANISER, 50)) as any[];
        expect(claim.taskAction).toEqual({ needed: false });
    });
});
