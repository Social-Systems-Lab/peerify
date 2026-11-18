// The Crew page's "Shifts & tasks" view (Crew round 2, feature 1; decisions F2, F4, F7, F8 of
// 2026-11-18). A pure summary of tasks ALREADY filtered and shaped by filterTasksForViewer (audience,
// decision B, private pending sign-ups and claims) and events ALREADY shaped by shapeEventsForViewer.
// It sends the browser a small object only: never a location, a participants note, a description,
// claims or the participants list itself. People's names only for organisers.
//
// - myShifts: shifts I'm pending or confirmed on, tasks assigned to me, tasks with my pending claim.
//   Upcoming only (F8): a shift until it ends, a task until the end of its date (or with no date).
// - openByEvent: what I could still sign up for, grouped by event in date order. Shifts not in review
//   or resolved, not started yet, where I'm not signed up and sign-up isn't closed (all places
//   confirmed, F2, or the F5 ceiling). Open, unassigned tasks linked to a visible event, without my
//   pending claim (F4). A shift whose event is missing or hidden goes under "Other" (event null), and
//   that event's title is never sent; a task needs its visible event.
// - allByEvent (organisers only): every upcoming shift and open task, filled ones included, with
//   names, for reviewing sign-ups (Crew page organiser view, F6, and the Crew Dashboard).

import type { Circle, TaskDisplay } from "@/models/models";
import {
    getShiftDisplayStatus,
    getShiftEndAt,
    getShiftSignupBlock,
    getShiftStartAt,
} from "@/components/modules/tasks/shift-task-utils";
import { countShiftSignups, crewSignupStatusOf } from "./crew-signup-status";
import { isRestrictedTaskAudience } from "./task-audience";
import { calendarDateOf, endOfCalendarDay } from "./shift-calendar";

export type CrewViewEvent = { id: string; title: string; startAt: string };

export type CrewViewPerson = {
    did: string;
    name?: string;
    handle?: string;
    picture?: Circle["picture"];
    status: "confirmed" | "pending";
};

// The viewer's own status. "waitingList": pending while all places are confirmed (F1).
export type CrewViewShiftStatus = "confirmed" | "pending" | "waitingList" | null;
export type CrewViewTaskStatus = "assigned" | "claimPending" | null;

export type CrewViewShift = {
    kind: "shift";
    id: string;
    title: string;
    eventId?: string;
    targetDate?: string;
    shiftStartTime?: string;
    shiftDurationMinutes?: number;
    slots: number;
    confirmedCount: number;
    openPlaces: number;
    crewOnly: boolean;
    viewerStatus: CrewViewShiftStatus;
    // Organisers only.
    pendingCount?: number;
    people?: CrewViewPerson[];
};

export type CrewViewTask = {
    kind: "task";
    id: string;
    title: string;
    eventId?: string;
    targetDate?: string;
    stage: TaskDisplay["stage"];
    viewerStatus: CrewViewTaskStatus;
    // Organisers only.
    assigneeName?: string;
    pendingClaimCount?: number;
};

export type CrewViewItem = CrewViewShift | CrewViewTask;

export type CrewViewGroup = {
    // null: "Other shifts" (no event, or one the viewer can't see).
    event: CrewViewEvent | null;
    shifts: CrewViewShift[];
    tasks: CrewViewTask[];
};

export type CrewShiftsView = {
    myShifts: CrewViewItem[];
    openByEvent: CrewViewGroup[];
    allByEvent?: CrewViewGroup[];
};

export type CrewViewEventInput = { _id?: unknown; title?: string; startAt?: Date | string };

const toIso = (value: unknown): string | undefined => {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

// The end of a task's due day, in the zone (shift-calendar.ts), not the server's.
const endOfDay = (value: unknown): Date | null => {
    const date = calendarDateOf(value);
    return date ? endOfCalendarDay(date) : null;
};

const isShift = (task: TaskDisplay) => (task.taskType ?? "outcome") === "shift";

// Sort key: when it happens; undated last.
const whenOf = (task: TaskDisplay): number => {
    const at = isShift(task) ? getShiftStartAt(task) : task.targetDate ? new Date(task.targetDate) : null;
    const time = at?.getTime();
    return time === undefined || Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
};

export const summarizeCrewShiftsView = (
    tasks: TaskDisplay[],
    events: CrewViewEventInput[],
    options: { viewerDid: string; isOrganiser: boolean; now: Date; profilesByDid?: Map<string, Circle> },
): CrewShiftsView => {
    const { viewerDid, isOrganiser, now, profilesByDid } = options;

    const visibleEvents = new Map<string, CrewViewEvent>();
    for (const event of events) {
        const id = event._id ? String(event._id) : "";
        const startAt = toIso(event.startAt);
        if (id && startAt) visibleEvents.set(id, { id, title: event.title ?? "Event", startAt });
    }
    const eventOf = (task: TaskDisplay): CrewViewEvent | null =>
        (task.eventId && visibleEvents.get(String(task.eventId))) || null;

    const sorted = [...tasks].sort((a, b) => whenOf(a) - whenOf(b) || a.title.localeCompare(b.title));

    const shiftItem = (task: TaskDisplay): CrewViewShift => {
        const participants = task.participants ?? [];
        const { confirmedCount, pendingCount } = countShiftSignups(task);
        const slots = task.slots ?? 0;
        const openPlaces = Math.max(slots - confirmedCount, 0);
        const own = participants.find((p) => p.userDid === viewerDid);
        const ownStatus = own ? crewSignupStatusOf(own) : null;
        const item: CrewViewShift = {
            kind: "shift",
            id: String(task._id),
            title: task.title,
            eventId: eventOf(task)?.id,
            targetDate: toIso(task.targetDate),
            shiftStartTime: task.shiftStartTime,
            shiftDurationMinutes: task.shiftDurationMinutes,
            slots,
            confirmedCount,
            openPlaces,
            crewOnly: isRestrictedTaskAudience(task.userGroups),
            viewerStatus: ownStatus === "pending" && openPlaces === 0 ? "waitingList" : ownStatus,
        };
        if (isOrganiser) {
            item.pendingCount = pendingCount;
            item.people = participants.map((participant) => {
                const profile = profilesByDid?.get(participant.userDid);
                return {
                    did: participant.userDid,
                    name: profile?.name,
                    handle: profile?.handle,
                    picture: profile?.picture,
                    status: crewSignupStatusOf(participant),
                };
            });
        }
        return item;
    };

    const taskItem = (task: TaskDisplay): CrewViewTask => {
        const claims = task.claims ?? [];
        const viewerStatus: CrewViewTaskStatus =
            task.assignedTo === viewerDid
                ? "assigned"
                : claims.some((c) => c.claimantDid === viewerDid && c.status === "pending")
                  ? "claimPending"
                  : null;
        const item: CrewViewTask = {
            kind: "task",
            id: String(task._id),
            title: task.title,
            eventId: eventOf(task)?.id,
            targetDate: toIso(task.targetDate),
            stage: task.stage,
            viewerStatus,
        };
        if (isOrganiser) {
            const assigneeName = task.assignee?.name || task.assignee?.handle;
            if (assigneeName) item.assigneeName = assigneeName;
            item.pendingClaimCount = claims.filter((c) => c.status === "pending").length;
        }
        return item;
    };

    const shiftNotOver = (task: TaskDisplay) => {
        const status = getShiftDisplayStatus(task, now);
        if (status === "review" || status === "completed") return false;
        // No usable schedule: getShiftDisplayStatus can't tell; leave it out of time-based lists.
        return Boolean(getShiftStartAt(task) && getShiftEndAt(task));
    };
    const taskNotOver = (task: TaskDisplay) => {
        if (task.stage === "resolved") return false;
        const end = endOfDay(task.targetDate);
        return !end || end >= now;
    };

    const myShifts: CrewViewItem[] = [];
    const open = new Map<string, CrewViewGroup>();
    const all = new Map<string, CrewViewGroup>();
    const groupIn = (groups: Map<string, CrewViewGroup>, event: CrewViewEvent | null) => {
        const key = event?.id ?? "";
        let group = groups.get(key);
        if (!group) {
            group = { event, shifts: [], tasks: [] };
            groups.set(key, group);
        }
        return group;
    };

    for (const task of sorted) {
        if (isShift(task)) {
            if (!shiftNotOver(task)) continue;
            const item = shiftItem(task);
            if (item.viewerStatus) myShifts.push(item);
            if (isOrganiser) groupIn(all, eventOf(task)).shifts.push(item);
            const notStarted = getShiftDisplayStatus(task, now) === "upcoming";
            if (!item.viewerStatus && notStarted && task.stage !== "review" && getShiftSignupBlock(task) === null) {
                groupIn(open, eventOf(task)).shifts.push(item);
            }
        } else {
            if (!taskNotOver(task)) continue;
            const item = taskItem(task);
            if (item.viewerStatus) myShifts.push(item);
            const openForClaims = task.stage === "open" && !task.assignedTo;
            const event = eventOf(task);
            // F4: tasks under their (visible) event only.
            if (!event || !openForClaims) continue;
            if (isOrganiser) groupIn(all, event).tasks.push(item);
            if (!item.viewerStatus) groupIn(open, event).tasks.push(item);
        }
    }

    // Events in date order; "Other" last.
    const ordered = (groups: Map<string, CrewViewGroup>) =>
        [...groups.values()].sort((a, b) => {
            if (!a.event) return 1;
            if (!b.event) return -1;
            return a.event.startAt.localeCompare(b.event.startAt) || a.event.title.localeCompare(b.event.title);
        });

    return {
        myShifts,
        openByEvent: ordered(open),
        ...(isOrganiser ? { allByEvent: ordered(all) } : {}),
    };
};
