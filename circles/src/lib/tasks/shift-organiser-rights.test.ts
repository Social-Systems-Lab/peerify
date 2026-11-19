// Run: IS_BUILD=true bun test src/lib/tasks/shift-organiser-rights.test.ts
// Staging round fixes 4 (2026-11-19):
// - Option (a) (Tim): Assign Tasks can confirm and decline shift sign-ups, not only Moderate Tasks.
//   Attendance, editing and deleting stay with Moderate Tasks. The shift page's Confirm and Decline
//   buttons and "N pending" follow (managesShiftSignups), as do the shifts and tasks lists.
// - F3: the circle Events timeline showed "N pending" on shift cards to crew members. The count is
//   for organisers only, as on the event crew panel: a timeline item carries showPendingCount from
//   the server (getTasksAction's showsShiftPendingCounts) and the card prints the count only then.

import { describe, expect, test } from "bun:test";
import { getShiftOrganiserProfileNote, managesShiftSignups } from "@/components/modules/tasks/shift-task-utils";
import { getTimelineShiftPendingSummary, toShiftTimelineItems } from "@/lib/tasks/shift-timeline";
import type { TaskDisplay } from "@/models/models";

const none = { canAssign: false, canModerate: false };

describe("option (a): who confirms and declines sign-ups", () => {
    test("Assign Tasks or Moderate Tasks", () => {
        expect(managesShiftSignups({ canAssign: true, canModerate: false })).toBe(true);
        expect(managesShiftSignups({ canAssign: false, canModerate: true })).toBe(true);
        expect(managesShiftSignups(none)).toBe(false);
    });
});

describe("the shift page's 'complete your profile' note", () => {
    const shift = { taskType: "shift" as const };
    test("neither right, Assign held back by the profile: to confirm sign-ups", () => {
        expect(
            getShiftOrganiserProfileNote(shift, { ...none, assignNeedsVerifiedProfile: true })?.startsWith(
                "To confirm sign-ups, complete your profile",
            ),
        ).toBe(true);
    });
    test("neither right, Moderate held back by the profile: to confirm sign-ups and review attendance", () => {
        expect(
            getShiftOrganiserProfileNote(shift, { ...none, moderateNeedsVerifiedProfile: true })?.startsWith(
                "To confirm sign-ups and review attendance, complete your profile",
            ),
        ).toBe(true);
    });
    test("Assign but not Moderate, Moderate held back by the profile: to review attendance", () => {
        expect(
            getShiftOrganiserProfileNote(shift, {
                canAssign: true,
                canModerate: false,
                moderateNeedsVerifiedProfile: true,
            })?.startsWith("To review attendance, complete your profile"),
        ).toBe(true);
    });
    test("nothing held back, or not a shift: no note", () => {
        expect(getShiftOrganiserProfileNote(shift, none)).toBeNull();
        expect(getShiftOrganiserProfileNote(shift, { canAssign: true, canModerate: false })).toBeNull();
        expect(
            getShiftOrganiserProfileNote({ taskType: "outcome" }, { ...none, assignNeedsVerifiedProfile: true }),
        ).toBeNull();
    });
});

describe("F3: the Events timeline's 'N pending'", () => {
    const now = new Date("2026-12-01T10:00:00Z");
    const door = {
        _id: "door",
        title: "Door crew",
        taskType: "shift",
        stage: "open",
        slots: 2,
        targetDate: "2026-12-06T12:00:00.000Z",
        shiftStartTime: "18:00",
        shiftDurationMinutes: 120,
        participants: [],
        pendingParticipantCount: 3, // what a crew member's copy carries (shapeTaskNotesForViewer)
    } as unknown as TaskDisplay;

    test("crew: the item says no, and the card prints no count", () => {
        const [item] = toShiftTimelineItems([door], now, false);
        expect(item.showPendingCount).toBe(false);
        expect(getTimelineShiftPendingSummary(item)).toBeNull();
    });

    test("organisers: the count", () => {
        const [item] = toShiftTimelineItems([door], now, true);
        expect(getTimelineShiftPendingSummary(item)).toBe("3 pending");
    });

    test("items keep their start and end, and past shifts drop out", () => {
        const [item] = toShiftTimelineItems([door], now, true);
        expect(item.startAt).toBe("2026-12-06T16:00:00.000Z"); // 18:00 SAST
        expect(item.endAt).toBe("2026-12-06T18:00:00.000Z");
        expect(toShiftTimelineItems([door], new Date("2026-12-07T00:00:00Z"), true)).toEqual([]);
    });
});
