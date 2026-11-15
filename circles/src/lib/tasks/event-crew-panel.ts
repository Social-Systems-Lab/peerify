// The event page's crew panel (Crew R1, item 3, 2026-11-14): the shifts and tasks linked to an
// event, shaped for the viewer. Everyone who may see a shift gets its time, slots and counts, and
// their own sign-up status. Only the event's organisers (tasks.assign / tasks.moderate on the host
// circle, or platform admins) get who signed up. Works on tasks already filtered and shaped by
// filterTasksForViewer, so audiences and D3/decision B still apply.

import type { Circle, TaskDisplay } from "@/models/models";
import { format } from "date-fns";
import { isRestrictedTaskAudience } from "./task-audience";

export type CrewSignupStatus = "confirmed" | "pending";

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
            const statusOf = (participant: { verifiedAt?: Date }): CrewSignupStatus =>
                participant.verifiedAt ? "confirmed" : "pending";
            const own = viewerDid ? participants.find((p) => p.userDid === viewerDid) : undefined;
            const shift: EventCrewShift = {
                id,
                title: task.title,
                targetDate: toIso(task.targetDate),
                shiftStartTime: task.shiftStartTime,
                shiftDurationMinutes: task.shiftDurationMinutes,
                slots: task.slots ?? 0,
                confirmedCount: participants.filter((p) => !!p.verifiedAt).length,
                pendingCount: participants.filter((p) => !p.verifiedAt).length,
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

// "Fri 5 Dec · 18:00–20:00" (date in the viewer's timezone; the times as stored).
export const formatShiftWhen = (
    shift: Pick<EventCrewShift, "targetDate" | "shiftStartTime" | "shiftDurationMinutes">,
) => {
    const parts: string[] = [];
    if (shift.targetDate) {
        const date = new Date(shift.targetDate);
        if (!Number.isNaN(date.getTime())) parts.push(format(date, "EEE d MMM"));
    }
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
