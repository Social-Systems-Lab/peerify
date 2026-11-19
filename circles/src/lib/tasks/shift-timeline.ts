// The circle Events timeline's shift entries (moved out of events-tabs.tsx, 2026-11-19).
// F3: "N pending" is for organisers only, as on the event crew panel. A crew member's copy of a
// shift still carries pendingParticipantCount (the shift page uses it for "More people have offered
// than there are places"), so the card prints the count only when the server said the viewer is an
// organiser (getTasksAction's showsShiftPendingCounts).

import {
    getShiftEndAt,
    getShiftPendingSummary,
    getShiftStartAt,
    isShiftTask,
} from "@/components/modules/tasks/shift-task-utils";
import type { TaskDisplay } from "@/models/models";

export type ShiftTimelineItem = {
    id: string;
    task: TaskDisplay;
    circleHandle?: string;
    startAt: Date | string | null;
    endAt?: Date | string | null;
    // Organisers only (F3).
    showPendingCount?: boolean;
};

// Upcoming and ongoing shifts, with their real start and end.
export const toShiftTimelineItems = (tasks: TaskDisplay[], now: Date, showPendingCount: boolean): ShiftTimelineItem[] =>
    tasks
        .filter((task) => isShiftTask(task))
        .map((task) => {
            const startAt = getShiftStartAt(task);
            const endAt = getShiftEndAt(task);
            return {
                id: (task as { _id?: { toString(): string } })._id?.toString?.() || String(task._id || ""),
                task,
                circleHandle: task.circle?.handle,
                startAt: startAt?.toISOString() ?? null,
                endAt: endAt?.toISOString() ?? null,
                showPendingCount,
            };
        })
        .filter((shift) => {
            if (!shift.startAt) return false;
            return new Date(shift.endAt ?? shift.startAt) >= now;
        });

export const getTimelineShiftPendingSummary = (item: ShiftTimelineItem) =>
    item.showPendingCount ? getShiftPendingSummary(item.task) : null;
