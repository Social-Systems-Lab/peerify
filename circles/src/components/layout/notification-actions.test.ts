// Run: IS_BUILD=true bun test src/components/layout/notification-actions.test.ts
// The bell's action button rules, moved out of notifications.tsx (2026-11-25, backlog item 3).
// These are today's labels and looks, unchanged by the move.

import { describe, expect, test } from "bun:test";
import { getNotificationActionClassName, getNotificationActionLabel } from "./notification-actions";

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
