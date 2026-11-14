// Who a task or shift is for (Crew R1, item 2, 2026-11-14). The form offers two choices:
// - "everyone": anyone who can view the circle's tasks (stored as ["everyone"]);
// - "crew": the circle's Crew, plus its moderators and admins so organisers keep seeing it.
// Visibility and signing up both go through the task's userGroups (filterTasksForViewer).

export type TaskAudience = "everyone" | "crew";

export const CREW_ONLY_USER_GROUPS = ["admins", "moderators", "crew"];

// A task whose audience is set and doesn't include "everyone" (an empty list means everyone, from
// before the audience could be chosen).
export const isRestrictedTaskAudience = (userGroups?: string[] | null): boolean =>
    Array.isArray(userGroups) && userGroups.length > 0 && !userGroups.includes("everyone");

export const audienceFromUserGroups = (userGroups?: string[] | null): TaskAudience =>
    isRestrictedTaskAudience(userGroups) ? "crew" : "everyone";

export const userGroupsForAudience = (audience: TaskAudience): string[] =>
    audience === "crew" ? [...CREW_ONLY_USER_GROUPS] : ["everyone"];

export const parseTaskAudience = (value: unknown): TaskAudience | null =>
    value === "crew" || value === "everyone" ? value : null;
