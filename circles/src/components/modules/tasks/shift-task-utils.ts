import { addMinutes } from "date-fns";
import { Circle, Task, TaskDisplay, TaskParticipant, TaskPermissions } from "@/models/models";
import { getShiftSignupCeiling } from "@/lib/tasks/shift-capacity";
import {
    calendarDateOf,
    DEFAULT_TIME_ZONE,
    formatCalendarDate,
    formatWallTime,
    zonedInstant,
} from "@/lib/tasks/shift-calendar";

type ShiftTaskLike = Pick<
    Task,
    "participants" | "shiftDurationMinutes" | "shiftStartTime" | "slots" | "stage" | "targetDate" | "taskType"
>;

export const SHIFT_DURATION_OPTIONS = [
    { value: 30, label: "30 minutes" },
    { value: 60, label: "1 hour" },
    { value: 120, label: "2 hours" },
    { value: 180, label: "3 hours" },
    { value: 240, label: "4 hours" },
] as const;

export type ShiftDisplayStatus = "review" | "upcoming" | "inProgress" | "completed";

export const isShiftTask = (task: Pick<Task, "taskType">) => (task.taskType ?? "outcome") === "shift";

// The shift's date is a calendar date and its start time wall-clock time, both in the shift's zone
// (shift-calendar.ts; fix of 2026-11-18). Never the zone this code happens to run in.
export const getShiftStartAt = (
    task: Pick<Task, "targetDate" | "shiftStartTime">,
    timeZone: string = DEFAULT_TIME_ZONE,
) => {
    if (!task.targetDate || !task.shiftStartTime) {
        return null;
    }
    const date = calendarDateOf(task.targetDate, timeZone);
    return date ? zonedInstant(date, task.shiftStartTime, timeZone) : null;
};

export const getShiftEndAt = (
    task: Pick<Task, "targetDate" | "shiftStartTime" | "shiftDurationMinutes">,
    timeZone: string = DEFAULT_TIME_ZONE,
) => {
    const shiftStartAt = getShiftStartAt(task, timeZone);
    if (!shiftStartAt || !task.shiftDurationMinutes) {
        return null;
    }

    return addMinutes(shiftStartAt, task.shiftDurationMinutes);
};

export const getShiftDisplayStatus = (task: ShiftTaskLike, now = new Date()): ShiftDisplayStatus => {
    if (task.stage === "review") {
        return "review";
    }

    if (task.stage === "resolved") {
        return "completed";
    }

    const shiftStartAt = getShiftStartAt(task);
    const shiftEndAt = getShiftEndAt(task);
    if (!shiftStartAt || !shiftEndAt) {
        return task.stage === "inProgress" ? "inProgress" : "upcoming";
    }
    if (now < shiftStartAt) {
        return "upcoming";
    }

    if (now >= shiftEndAt) {
        return "completed";
    }

    return "inProgress";
};

// Counts (2026-11-16): a viewer who doesn't manage the task gets only confirmed participants and their
// own entry in participants[], plus pendingParticipantCount; managers get every entry and no count.
type ShiftCountable = Pick<Task, "participants"> & { pendingParticipantCount?: number };

export const getShiftSignupSummary = (task: ShiftCountable & Pick<Task, "slots">) => {
    const signedUpCount = getShiftSignedUpCount(task);
    return `${signedUpCount} / ${task.slots ?? "?"} signed up`;
};

export const getShiftConfirmedCount = (task: Pick<Task, "participants">) =>
    task.participants?.filter((participant) => participant.verifiedAt).length ?? 0;

export const getShiftPendingCount = (task: ShiftCountable) =>
    task.pendingParticipantCount ??
    task.participants?.filter((participant) => !participant.verifiedAt).length ??
    0;

export const getShiftSignedUpCount = (task: ShiftCountable) => getShiftConfirmedCount(task) + getShiftPendingCount(task);

// Crew round 2 (2026-11-18): places are counted by CONFIRMED people only. Pending sign-ups may exceed
// places, up to the F5 ceiling; the server enforces the same rule (joinShiftTaskAction).
export const getShiftOpenPlaces = (task: Pick<Task, "participants" | "slots">) =>
    Math.max((task.slots ?? 0) - getShiftConfirmedCount(task), 0);

// Why a new sign-up would be refused, or null when it wouldn't.
export type ShiftSignupBlock = "allConfirmed" | "manyOffered" | null;
export const getShiftSignupBlock = (task: ShiftCountable & Pick<Task, "slots">): ShiftSignupBlock => {
    if (getShiftOpenPlaces(task) < 1) return "allConfirmed";
    if (getShiftSignedUpCount(task) >= getShiftSignupCeiling(task.slots ?? 0)) return "manyOffered";
    return null;
};

// More people have offered than there are places, and places are still open: the organiser chooses.
export const isShiftOversubscribed = (task: ShiftCountable & Pick<Task, "slots">) =>
    getShiftOpenPlaces(task) > 0 && getShiftSignedUpCount(task) >= (task.slots ?? 0);

// F3: "2 places · 1 left", counting confirmed only; no pending count.
export const formatShiftPlaces = (slots: number, confirmedCount: number) => {
    if (slots < 1) return "Places to be confirmed";
    const placesText = `${slots} ${slots === 1 ? "place" : "places"}`;
    const left = Math.max(slots - confirmedCount, 0);
    return left > 0 ? `${placesText} · ${left} left` : `${placesText} · all confirmed`;
};

export const getShiftConfirmedSummary = (task: Pick<Task, "participants" | "slots">) =>
    `${getShiftConfirmedCount(task)} / ${task.slots ?? "?"} confirmed`;

export const getShiftPendingSummary = (task: ShiftCountable) => {
    const pendingCount = getShiftPendingCount(task);
    if (!pendingCount) {
        return null;
    }

    return pendingCount === 1 ? "1 pending" : `${pendingCount} pending`;
};

export type ShiftParticipantEntry = {
    participant: TaskParticipant;
    profile?: Circle;
};

const mapShiftParticipantEntries = (
    task: Pick<TaskDisplay, "participants" | "participantProfiles">,
    predicate: (participant: TaskParticipant) => boolean,
): ShiftParticipantEntry[] =>
    (task.participants ?? [])
        .filter(predicate)
        .map((participant) => ({
            participant,
            profile: task.participantProfiles?.find((profile) => profile.did === participant.userDid),
        }));

export const getShiftConfirmedParticipants = (
    task: Pick<TaskDisplay, "participants" | "participantProfiles">,
): ShiftParticipantEntry[] => mapShiftParticipantEntries(task, (participant) => Boolean(participant.verifiedAt));

export const getShiftPendingParticipants = (
    task: Pick<TaskDisplay, "participants" | "participantProfiles">,
): ShiftParticipantEntry[] => mapShiftParticipantEntries(task, (participant) => !participant.verifiedAt);

// Labels (shift dates 3/5, 2026-11-18): the calendar date in the shift's zone and the wall-clock
// times as stored, so the server render and the browser print the same text.

// Shifts list, date column: "Sun 6 Dec 2026".
export const formatShiftListDate = (task: Pick<Task, "targetDate">) =>
    formatCalendarDate(task.targetDate, "EEE d MMM yyyy") ?? "No date";

// Shifts list, time column: "18:00".
export const formatShiftListTime = (task: Pick<Task, "shiftStartTime">) =>
    formatWallTime(task.shiftStartTime, "HH:mm") ?? "No time";

// Shift and task page: "December 6th, 2026".
export const formatTargetDateLong = (task: Pick<Task, "targetDate">) =>
    formatCalendarDate(task.targetDate, "PPP") ?? "Not set";

// Home's "Upcoming shifts": "Sun, 6 Dec · 6:00 PM - 8:00 PM".
export const formatShiftDayAndTimes = (task: Pick<Task, "targetDate" | "shiftStartTime" | "shiftDurationMinutes">) => {
    const day = formatCalendarDate(task.targetDate, "EEE, d MMM");
    const start = formatWallTime(task.shiftStartTime, "h:mm a");
    if (!day || !start) return "Schedule to be confirmed";
    const end = task.shiftDurationMinutes
        ? formatWallTime(task.shiftStartTime, "h:mm a", task.shiftDurationMinutes)
        : null;
    return end ? `${day} · ${start} - ${end}` : `${day} · ${start}`;
};

// Tasks list, due date column (shift dates 5/5): "6 Dec 2026", the calendar date in the zone.
export const formatTaskListDate = (value?: Date | string | null) =>
    formatCalendarDate(value, "d MMM yyyy") ?? "No due date";

// The hint where "Important for participants" is held back (Tim, 2026-11-18): signing up isn't
// enough on a crew-only shift (decision B: confirmed participants only).
export const getParticipantNotesHiddenHint = (isSignedUp: boolean) =>
    isSignedUp
        ? "Details for participants appear once an organiser confirms your sign-up."
        : "Details for participants appear once you’re confirmed.";

// Confirming and declining shift sign-ups, and seeing "N pending": Assign Tasks or Moderate Tasks
// (Tim, 2026-11-19, option (a)). Attendance, editing and deleting stay with Moderate Tasks.
export const managesShiftSignups = (permissions: Pick<TaskPermissions, "canAssign" | "canModerate">) =>
    permissions.canAssign || permissions.canModerate;

// On a shift, for someone the circle's access rules give Assign or Moderate Tasks whose profile isn't
// verified: those need a verified profile (kept, Tim 2026-11-19), so the page says what's missing.
const PROFILE_STEPS = "complete your profile: a picture, a short About text and the Community Guidelines.";

export const getShiftOrganiserProfileNote = (
    task: Pick<TaskDisplay, "taskType">,
    permissions: Pick<
        TaskPermissions,
        "canAssign" | "canModerate" | "assignNeedsVerifiedProfile" | "moderateNeedsVerifiedProfile"
    >,
): string | null => {
    if (!isShiftTask(task)) return null;
    if (!managesShiftSignups(permissions)) {
        if (permissions.moderateNeedsVerifiedProfile)
            return `To confirm sign-ups and review attendance, ${PROFILE_STEPS}`;
        if (permissions.assignNeedsVerifiedProfile) return `To confirm sign-ups, ${PROFILE_STEPS}`;
        return null;
    }
    if (!permissions.canModerate && permissions.moderateNeedsVerifiedProfile) {
        return `To review attendance, ${PROFILE_STEPS}`;
    }
    return null;
};
