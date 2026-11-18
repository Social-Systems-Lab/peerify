import { addMinutes } from "date-fns";
import { Circle, Task, TaskDisplay, TaskParticipant } from "@/models/models";
import { getShiftSignupCeiling } from "@/lib/tasks/shift-capacity";

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

export const getShiftStartAt = (task: Pick<Task, "targetDate" | "shiftStartTime">) => {
    if (!task.targetDate || !task.shiftStartTime) {
        return null;
    }

    const [hours, minutes] = task.shiftStartTime.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
        return null;
    }

    const shiftDate = new Date(task.targetDate);
    if (Number.isNaN(shiftDate.getTime())) {
        return null;
    }

    shiftDate.setHours(hours, minutes, 0, 0);
    return shiftDate;
};

export const getShiftEndAt = (task: Pick<Task, "targetDate" | "shiftStartTime" | "shiftDurationMinutes">) => {
    const shiftStartAt = getShiftStartAt(task);
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
