// Client-safe. Server messages for tasks and shifts. A shift is stored as a task (taskType "shift"),
// and the form shows the server's message as the toast text, so a saved shift said
// "Task updated successfully" (Tim, 2026-11-15). Shifts now get their own wording; tasks keep theirs.

export type TaskMessageKind = "created" | "updated" | "deleted" | "createFailed" | "updateFailed" | "deleteFailed";

const isShift = (taskType: string | null | undefined) => taskType === "shift";

const TASK_MESSAGES: Record<TaskMessageKind, string> = {
    created: "Task submitted successfully",
    updated: "Task updated successfully",
    deleted: "Task deleted successfully",
    createFailed: "Failed to submit task",
    updateFailed: "Failed to update task",
    deleteFailed: "Failed to delete task",
};

const SHIFT_MESSAGES: Record<TaskMessageKind, string> = {
    created: "Shift created",
    updated: "Shift updated",
    deleted: "Shift deleted",
    createFailed: "Failed to create shift",
    updateFailed: "Failed to update shift",
    deleteFailed: "Failed to delete shift",
};

export const taskMessage = (taskType: string | null | undefined, kind: TaskMessageKind): string =>
    (isShift(taskType) ? SHIFT_MESSAGES : TASK_MESSAGES)[kind];

// "Task" or "Shift", for messages built around a noun.
export const taskNoun = (taskType: string | null | undefined): "Task" | "Shift" => (isShift(taskType) ? "Shift" : "Task");
