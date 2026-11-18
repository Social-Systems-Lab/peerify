// A shift sign-up's status and a shift's counts, shared by the event page's crew panel
// (event-crew-panel.ts) and the Crew page's "Shifts & tasks" view (crew-shifts-view.ts), so both
// count the same way. Works on tasks already shaped by filterTasksForViewer: a viewer who doesn't
// manage the task gets only confirmed participants and their own entry in participants[], plus
// pendingParticipantCount (all pending sign-ups, their own included; 2026-11-16).

import type { TaskDisplay, TaskParticipant } from "@/models/models";

export type CrewSignupStatus = "confirmed" | "pending";

// A stored null verifiedAt counts as pending (2026-11-18 audit), as the server's matching does.
export const crewSignupStatusOf = (participant: Pick<TaskParticipant, "verifiedAt">): CrewSignupStatus =>
    participant.verifiedAt ? "confirmed" : "pending";

export const countShiftSignups = (
    task: Pick<TaskDisplay, "participants"> & { pendingParticipantCount?: number },
): { confirmedCount: number; pendingCount: number } => {
    const participants = task.participants ?? [];
    const confirmedCount = participants.filter((p) => crewSignupStatusOf(p) === "confirmed").length;
    const pendingCount =
        task.pendingParticipantCount ?? participants.filter((p) => crewSignupStatusOf(p) === "pending").length;
    return { confirmedCount, pendingCount };
};
