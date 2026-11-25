// Run: IS_BUILD=true bun test src/components/layout/notification-actions.test.ts
// The bell's action button rules, moved out of notifications.tsx (2026-11-25, backlog item 3).
// These are today's labels and looks, unchanged by the move.

import { describe, expect, test } from "bun:test";
import {
    getActionNeededReminder,
    getInlineTaskAction,
    getNotificationActionClassName,
    getNotificationActionLabel,
} from "./notification-actions";

const HREF = "/circles/artist/tasks/t1";

describe("action button label", () => {
    test("no link: no button", () => {
        expect(getNotificationActionLabel("crew_application", null)).toBeNull();
        expect(getNotificationActionLabel("task_assigned", null)).toBeNull();
    });

    test("crew applications and other requests: Review", () => {
        expect(getNotificationActionLabel("crew_application", HREF)).toBe("Review");
        expect(getNotificationActionLabel("event_host_change_requested", HREF)).toBe("Review");
        expect(getNotificationActionLabel("admin_invitation_received", HREF)).toBe("Review");
    });

    test("task notices, as before", () => {
        expect(getNotificationActionLabel("task_assigned", HREF)).toBe("Review");
        expect(getNotificationActionLabel("task_shift_signup", HREF)).toBe("Review");
        expect(getNotificationActionLabel("task_claim_submitted", HREF)).toBe("View");
        expect(getNotificationActionLabel("task_claim_approved", HREF)).toBe("View");
        expect(getNotificationActionLabel("task_accepted", HREF)).toBe("View");
        expect(getNotificationActionLabel("task_shift_confirmed", HREF)).toBe("Open");
    });

    test("others", () => {
        expect(getNotificationActionLabel("contact_request_received", HREF)).toBe("Respond");
        expect(getNotificationActionLabel("pm_received", HREF)).toBe("Reply");
        expect(getNotificationActionLabel("crew_application_approved", HREF)).toBe("View Crew");
        expect(getNotificationActionLabel("crew_broadcast", HREF)).toBe("View Broadcast");
        expect(getNotificationActionLabel("post_like", HREF)).toBeNull();
    });
});

describe("action button look", () => {
    test("contact requests stand out; everything else is the plain button", () => {
        expect(getNotificationActionClassName("contact_request_received")).toContain("bg-amber-500");
        expect(getNotificationActionClassName("task_assigned")).toContain("border");
        expect(getNotificationActionClassName("task_assigned")).not.toContain("bg-amber-500");
    });
});

// Backlog item 3 (2026-11-25): task notices that still need their recipient get Approve / Accept
// in the notice, stand out, and carry an "Action needed" line, until handled.
const NEEDED_CLAIM = { needed: true, claimId: "claim-1" };
const NEEDED = { needed: true };
const HANDLED = { needed: false };

describe("inline task actions", () => {
    test("a pending claim: Approve, for organisers", () => {
        expect(getInlineTaskAction("task_claim_submitted", NEEDED_CLAIM)).toBe("approveClaim");
        expect(getNotificationActionLabel("task_claim_submitted", HREF, NEEDED_CLAIM)).toBe("Approve");
    });

    test("an assignment or an approved claim not yet confirmed: Accept", () => {
        expect(getNotificationActionLabel("task_assigned", HREF, NEEDED)).toBe("Accept");
        expect(getNotificationActionLabel("task_claim_approved", HREF, NEEDED)).toBe("Accept");
    });

    test("once handled: back to the usual labels", () => {
        expect(getNotificationActionLabel("task_claim_submitted", HREF, HANDLED)).toBe("View");
        expect(getNotificationActionLabel("task_assigned", HREF, HANDLED)).toBe("Review");
        expect(getNotificationActionLabel("task_claim_approved", HREF, HANDLED)).toBe("View");
        expect(getNotificationActionLabel("task_assigned", HREF, undefined)).toBe("Review");
    });

    test("a claim notice without a claim id can't approve: plain View", () => {
        expect(getInlineTaskAction("task_claim_submitted", NEEDED)).toBeNull();
        expect(getNotificationActionLabel("task_claim_submitted", HREF, NEEDED)).toBe("View");
    });

    test("other types never get an inline action", () => {
        expect(getInlineTaskAction("task_accepted", NEEDED)).toBeNull();
        expect(getInlineTaskAction("crew_application", NEEDED)).toBeNull();
    });

    test("no link: still no button", () => {
        expect(getNotificationActionLabel("task_assigned", null, NEEDED)).toBeNull();
    });
});

describe("the action-needed state", () => {
    test("reminder lines while needed", () => {
        expect(getActionNeededReminder("task_assigned", NEEDED)).toBe("Action needed: please confirm you'll do this");
        expect(getActionNeededReminder("task_claim_approved", NEEDED)).toBe(
            "Action needed: please confirm you'll do this",
        );
        expect(getActionNeededReminder("task_claim_submitted", NEEDED_CLAIM)).toContain("Action needed: approve");
    });

    test("no reminder once handled, or for other notices", () => {
        expect(getActionNeededReminder("task_assigned", HANDLED)).toBeNull();
        expect(getActionNeededReminder("task_claim_submitted", HANDLED)).toBeNull();
        expect(getActionNeededReminder("post_like", undefined)).toBeNull();
    });

    test("the button stands out while needed, and goes back to plain after", () => {
        expect(getNotificationActionClassName("task_assigned", NEEDED)).toContain("bg-amber-500");
        expect(getNotificationActionClassName("task_assigned", HANDLED)).not.toContain("bg-amber-500");
    });
});
