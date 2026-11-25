// Run: IS_BUILD=true bun test src/lib/data/task-confirm-reminder.test.ts
// Backlog item 3 (2026-11-25): after a task is assigned or a claim approved, the assignee must still
// confirm ("Confirm I'll do this"), and people forgot. The notice text
// now says so (bell and push). Other task notices are unchanged.
// The database is in-memory fakes (testing/fake-db.ts); nothing real is touched.

import { describe, expect, mock, test } from "bun:test";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const { buildNotificationBody, TASK_CONFIRM_REMINDER } = await import("./notifications");

const payload = { user: { name: "Sam" }, taskTitle: "Carry chairs" };

describe("confirm reminder in the assignee's notices", () => {
    test("task assigned", () => {
        expect(buildNotificationBody("task_assigned", payload)).toBe(
            "Sam assigned you to Carry chairs. Please confirm you'll do it.",
        );
    });

    test("claim approved", () => {
        expect(buildNotificationBody("task_claim_approved", payload)).toBe(
            "Carry chairs claim approved. Please confirm you'll do it.",
        );
    });

    test("other task notices: unchanged, no reminder", () => {
        expect(buildNotificationBody("task_claim_submitted", payload)).toBe("Sam claimed Carry chairs");
        expect(buildNotificationBody("task_claim_declined", payload)).toBe("Carry chairs claim declined");
        expect(buildNotificationBody("task_accepted", payload)).toBe("Sam accepted ‘Carry chairs’");
        for (const type of ["task_claim_submitted", "task_claim_declined", "task_accepted", "task_verified"]) {
            expect(buildNotificationBody(type, payload)).not.toContain(TASK_CONFIRM_REMINDER);
        }
    });
});
