// Run: IS_BUILD=true bun test src/lib/data/decision-notices-tasks.test.ts
// Crew polish (2026-11-25): shift sign-ups and task reviews stand out as "action needed" in the bell
// until they're handled, worked out on load from the task as it is now:
//  - task_shift_signup: the person who signed up is still a participant with no verifiedAt, on a
//    shift that isn't resolved (confirm sets verifiedAt; decline and leave remove them);
//  - task_submitted_for_review: a new task still in "review", or finished work submitted and not yet
//    verified (requesting changes clears submittedForReviewAt).
// The last block runs listNotificationsForUser on in-memory fakes (testing/fake-db.ts).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { getTaskNoticeAction, type TaskActionFacts } from "./notification-action-state";
import { getActionNeededReminder, getNotificationActionLabel } from "@/components/layout/notification-actions";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const TASK_ID = "64a000000000000000007101";
const ORGANISER = "did:test:organiser";
const FAN = "did:test:fan";
const OTHER_FAN = "did:test:other-fan";
const past = new Date("2026-11-20T10:00:00Z");

const shift = (overrides: Partial<TaskActionFacts> = {}): TaskActionFacts => ({
    _id: TASK_ID,
    taskType: "shift",
    stage: "open",
    participants: [{ userDid: FAN }],
    ...overrides,
});
const outcome = (overrides: Partial<TaskActionFacts> = {}): TaskActionFacts => ({
    _id: TASK_ID,
    taskType: "outcome",
    stage: "open",
    ...overrides,
});
const signupNotice = (did = FAN) => ({ user: { did }, taskId: TASK_ID });
const reviewNotice = { user: { did: FAN }, taskId: TASK_ID };

const signup = (task: TaskActionFacts | undefined, did = FAN) =>
    getTaskNoticeAction("task_shift_signup", signupNotice(did), task, ORGANISER);
const review = (task: TaskActionFacts | undefined) =>
    getTaskNoticeAction("task_submitted_for_review", reviewNotice, task, ORGANISER);

describe("task_shift_signup", () => {
    test("signed up, not confirmed: needed", () => {
        expect(signup(shift())).toEqual({ needed: true });
        expect(signup(shift({ participants: [{ userDid: FAN, verifiedAt: null }] }))).toEqual({ needed: true });
    });

    test("confirmed: not needed", () => {
        expect(signup(shift({ participants: [{ userDid: FAN, verifiedAt: past }] }))).toEqual({ needed: false });
    });

    test("declined or left (no longer a participant): not needed", () => {
        expect(signup(shift({ participants: [{ userDid: OTHER_FAN }] }))).toEqual({ needed: false });
        expect(signup(shift({ participants: [] }))).toEqual({ needed: false });
    });

    test("someone else's pending sign-up doesn't count for this notice", () => {
        expect(signup(shift({ participants: [{ userDid: OTHER_FAN }] }), FAN)).toEqual({ needed: false });
    });

    test("shift resolved, or gone: not needed", () => {
        expect(signup(shift({ stage: "resolved" }))).toEqual({ needed: false });
        expect(signup(undefined)).toEqual({ needed: false });
    });

    test("an outcome task can't have a shift sign-up", () => {
        expect(signup(outcome({ participants: [{ userDid: FAN }] }))).toEqual({ needed: false });
    });

    test("reminder line, and the button stays Review", () => {
        expect(getActionNeededReminder("task_shift_signup", { needed: true })).toBe(
            "Action needed: confirm or decline this sign-up",
        );
        expect(getNotificationActionLabel("task_shift_signup", "/x", { needed: true })).toBe("Review");
    });
});

describe("task_submitted_for_review", () => {
    test("a new task still waiting for approval: needed; once opened: not", () => {
        expect(review(outcome({ stage: "review" }))).toEqual({ needed: true });
        expect(review(shift({ stage: "review" }))).toEqual({ needed: true });
        expect(review(outcome({ stage: "open" }))).toEqual({ needed: false });
    });

    test("finished work submitted and not verified: needed", () => {
        expect(review(outcome({ stage: "inProgress", submittedForReviewAt: past }))).toEqual({ needed: true });
    });

    test("verified, changes requested (submission cleared), or resolved: not needed", () => {
        expect(review(outcome({ stage: "inProgress", submittedForReviewAt: past, verifiedAt: past }))).toEqual({
            needed: false,
        });
        expect(review(outcome({ stage: "inProgress", submittedForReviewAt: null }))).toEqual({ needed: false });
        expect(review(outcome({ stage: "resolved", submittedForReviewAt: past }))).toEqual({ needed: false });
    });

    test("task gone: not needed", () => {
        expect(review(undefined)).toEqual({ needed: false });
    });

    test("reminder line, and the button stays View", () => {
        expect(getActionNeededReminder("task_submitted_for_review", { needed: true })).toBe(
            "Action needed: review this task",
        );
        expect(getNotificationActionLabel("task_submitted_for_review", "/x", { needed: true })).toBe("View");
    });
});

const { listNotificationsForUser } = await import("./notifications");

describe("listNotificationsForUser", () => {
    beforeEach(() => {
        fakeDb.reset({
            Tasks: [
                {
                    _id: new ObjectId(TASK_ID),
                    title: "Door",
                    taskType: "shift",
                    stage: "open",
                    participantNotes: "door code 4711",
                    participants: [
                        { userDid: FAN, joinedAt: past },
                        { userDid: OTHER_FAN, joinedAt: past, verifiedAt: past },
                    ],
                },
            ],
            Notifications: [FAN, OTHER_FAN].map((did) => ({
                _id: new ObjectId(),
                userId: ORGANISER,
                type: "task_shift_signup",
                content: signupNotice(did),
                isRead: false,
                createdAt: new Date(),
            })),
        });
    });

    test("pending sign-up: needed; confirmed one: not; nothing from the shift is sent", async () => {
        const notices = (await listNotificationsForUser(ORGANISER, 50)) as any[];
        const of = (did: string) => notices.find((n) => n.content.user.did === did);
        expect(of(FAN).action).toEqual({ needed: true });
        expect(of(OTHER_FAN).action).toEqual({ needed: false });
        expect(JSON.stringify(notices)).not.toContain("4711");
        expect(JSON.stringify(notices)).not.toContain("joinedAt");
    });
});
