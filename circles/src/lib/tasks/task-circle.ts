// Client-safe (no db). A task or shift can only be acted on through its own circle (2026-11-16).
// The task actions take the circle from the URL (circleHandle) and check the caller's rights there,
// but load the task by id alone; without this check an admin of any circle could act on another
// circle's task by passing their own circle's handle. getTaskAction has had this check all along.

export const isTaskInCircle = (
    task: { circleId?: unknown } | null | undefined,
    circle: { _id?: unknown } | null | undefined,
): boolean => !!task?.circleId && !!circle?._id && String(task.circleId) === String(circle._id);
