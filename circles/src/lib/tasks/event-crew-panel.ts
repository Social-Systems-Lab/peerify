// The event page's crew panel (Crew R1, item 3, 2026-11-14): the shifts and tasks linked to an
// event, shaped for the viewer. Everyone who may see a shift gets its time, slots and counts, and
// their own sign-up status. Only the event's organisers (tasks.assign / tasks.moderate on the host
// circle, or platform admins) get who signed up. Works on tasks already filtered and shaped by
// filterTasksForViewer, so audiences and D3/decision B still apply.

import type { Circle, TaskDisplay } from "@/models/models";
import { formatCalendarDate } from "./shift-calendar";
import { isRestrictedTaskAudience } from "./task-audience";
import { countShiftSignups, crewSignupStatusOf, type CrewSignupStatus } from "./crew-signup-status";

export type { CrewSignupStatus };

export type EventCrewPerson = {
    did: string;
    name?: string;
    handle?: string;
    picture?: Circle["picture"];
    status: CrewSignupStatus;
};

export type EventCrewShift = {
    id: string;
    title: string;
    targetDate?: string;
    shiftStartTime?: string;
    shiftDurationMinutes?: number;
    slots: number;
    confirmedCount: number;
    pendingCount: number;
    crewOnly: boolean;
    viewerStatus: CrewSignupStatus | null;
    // Organisers only.
    people?: EventCrewPerson[];
};

export type EventCrewTask = {
    id: string;
    title: string;
    stage: TaskDisplay["stage"];
    targetDate?: string;
    assigneeName?: string;
};

export type EventCrewPanel = {
    shifts: EventCrewShift[];
    tasks: EventCrewTask[];
};

const toIso = (value: unknown): string | undefined => {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const shiftSortKey = (shift: EventCrewShift) => `${shift.targetDate ?? "9999"}T${shift.shiftStartTime ?? "99:99"}`;

export const summarizeEventCrew = (
    tasks: TaskDisplay[],
    options: { viewerDid?: string; isOrganiser: boolean; profilesByDid?: Map<string, Circle> },
): EventCrewPanel => {
    const { viewerDid, isOrganiser, profilesByDid } = options;
    const shifts: EventCrewShift[] = [];
    const outcomeTasks: EventCrewTask[] = [];

    for (const task of tasks) {
        const id = String(task._id);
        if ((task.taskType ?? "outcome") === "shift") {
            const participants = task.participants ?? [];
            const statusOf = crewSignupStatusOf;
            const { confirmedCount, pendingCount } = countShiftSignups(task);
            const own = viewerDid ? participants.find((p) => p.userDid === viewerDid) : undefined;
            const shift: EventCrewShift = {
                id,
                title: task.title,
                targetDate: toIso(task.targetDate),
                shiftStartTime: task.shiftStartTime,
                shiftDurationMinutes: task.shiftDurationMinutes,
                slots: task.slots ?? 0,
                confirmedCount,
                // Pending sign-ups other than the viewer's own aren't in participants[] for viewers who
                // don't manage the task (2026-11-16); the count comes in pendingParticipantCount.
                pendingCount,
                crewOnly: isRestrictedTaskAudience(task.userGroups),
                viewerStatus: own ? statusOf(own) : null,
            };
            if (isOrganiser) {
                shift.people = participants.map((participant) => {
                    const profile = profilesByDid?.get(participant.userDid);
                    return {
                        did: participant.userDid,
                        name: profile?.name,
                        handle: profile?.handle,
                        picture: profile?.picture,
                        status: statusOf(participant),
                    };
                });
            }
            shifts.push(shift);
        } else {
            outcomeTasks.push({
                id,
                title: task.title,
                stage: task.stage,
                targetDate: toIso(task.targetDate),
                assigneeName: task.assignee?.name || task.assignee?.handle,
            });
        }
    }

    shifts.sort((a, b) => shiftSortKey(a).localeCompare(shiftSortKey(b)));
    return { shifts, tasks: outcomeTasks };
};

// The panel shows only when the viewer can see a shift or task, or can create one. A follower who
// isn't crew, on an event whose shifts are all crew-only, gets no panel (Tim, 2026-11-15).
export const shouldShowEventCrewPanel = (
    panel: EventCrewPanel,
    rights: { canCreateShift: boolean; canCreateTask: boolean },
): boolean => panel.shifts.length > 0 || panel.tasks.length > 0 || rights.canCreateShift || rights.canCreateTask;

// "Fri 5 Dec · 18:00–20:00": the calendar date in the shift's zone and the wall-clock times as stored,
// the same text on the server and in any browser (shift-calendar.ts, 2026-11-18).
export const formatShiftWhen = (
    shift: Pick<EventCrewShift, "targetDate" | "shiftStartTime" | "shiftDurationMinutes">,
) => {
    const parts: string[] = [];
    const date = formatCalendarDate(shift.targetDate, "EEE d MMM");
    if (date) parts.push(date);
    if (shift.shiftStartTime) {
        let time = shift.shiftStartTime;
        const [hours, minutes] = shift.shiftStartTime.split(":").map(Number);
        if (shift.shiftDurationMinutes && Number.isFinite(hours) && Number.isFinite(minutes)) {
            const end = (hours * 60 + minutes + shift.shiftDurationMinutes) % (24 * 60);
            time += `–${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
        }
        parts.push(time);
    }
    return parts.join(" · ");
};

// " · due 6 Dec" for a task row in the event's crew panel: the calendar date in the zone (shift dates 5/5).
export const formatTaskDue = (task: Pick<EventCrewTask, "targetDate">) => {
    const date = formatCalendarDate(task.targetDate, "d MMM");
    return date ? ` · due ${date}` : "";
};
