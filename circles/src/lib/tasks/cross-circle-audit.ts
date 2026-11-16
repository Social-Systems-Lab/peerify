// Pure: no database. The logic of scripts/check-cross-circle-task-actions.ts (2026-11-16).
// Until fix/task-actions-circle-check, an admin or moderator of any circle could act on another
// circle's task by id. This looks at what the stored data shows about who acted on each task and
// flags actors who aren't the author, an admin or moderator of the task's own circle, the owner of a
// personal circle or a platform admin. Only ids, kinds and dates come out; never people.
//
// What the data shows:
// - on the task: participants[].verifiedBy (shift sign-up confirmed), participants[].attendanceVerifiedBy,
//   claims[].reviewedBy (claim approved/declined), claimApprovedBy, reviewRequestedChangesBy,
//   verifiedBy (completion verified), acceptedBy and submittedForReviewBy (must be the assignee);
// - in notifications: content.user.did on task_assigned (who assigned) and task_status_changed (who
//   changed the stage), with content.taskId. A notification is only stored when someone was told,
//   so this misses some (e.g. assigning to oneself).
// Not visible at all: deleted tasks and priority changes.
// Roles are today's, so someone removed as moderator since then shows as "member, not manager".

export type AuditKind =
    | "shift_confirmation"
    | "attendance"
    | "claim_review"
    | "claim_approval"
    | "changes_requested"
    | "completion_verified"
    | "accepted_not_assignee"
    | "submitted_not_assignee"
    | "assignment"
    | "stage_change";

export const AUDIT_KINDS: AuditKind[] = [
    "shift_confirmation",
    "attendance",
    "claim_review",
    "claim_approval",
    "changes_requested",
    "completion_verified",
    "accepted_not_assignee",
    "submitted_not_assignee",
    "assignment",
    "stage_change",
];

type Did = string;

export type AuditTask = {
    _id: unknown;
    circleId?: unknown;
    createdBy?: Did;
    assignedTo?: Did;
    acceptedBy?: Did;
    acceptedAt?: Date;
    submittedForReviewBy?: Did;
    submittedForReviewAt?: Date;
    claimApprovedBy?: Did;
    claimApprovedAt?: Date;
    reviewRequestedChangesBy?: Did;
    reviewRequestedChangesAt?: Date;
    verifiedBy?: Did;
    verifiedAt?: Date;
    participants?: { verifiedBy?: Did; verifiedAt?: Date; attendanceVerifiedBy?: Did; attendanceVerifiedAt?: Date }[];
    claims?: { reviewedBy?: Did; reviewedAt?: Date }[];
};

export type AuditNotification = {
    type: string;
    createdAt?: Date;
    content?: { taskId?: unknown; user?: { did?: Did } | null } | null;
};

export type CircleRoles = {
    ownerDid?: Did; // a personal circle's owner
    managers: Set<Did>; // admins and moderators
    members: Set<Did>; // anyone with a membership
};

export type AuditFinding = {
    kind: AuditKind;
    taskId: string;
    at?: Date;
    // "not_member": not even a member of the task's circle (the strongest sign);
    // "member_not_manager": a member, but not admin/moderator today (could be custom access rules,
    // or a role removed since).
    reason: "not_member" | "member_not_manager" | "not_assignee";
};

export type AuditResult = {
    checked: Record<AuditKind, number>;
    byPlatformAdmin: Record<AuditKind, number>;
    findings: AuditFinding[];
    tasksWithoutCircle: number;
    notificationsForUnknownTasks: number;
};

const emptyCounts = (): Record<AuditKind, number> =>
    Object.fromEntries(AUDIT_KINDS.map((kind) => [kind, 0])) as Record<AuditKind, number>;

export const auditTaskActions = (input: {
    tasks: AuditTask[];
    notifications: AuditNotification[];
    rolesByCircleId: Map<string, CircleRoles>;
    platformAdmins: Set<Did>;
}): AuditResult => {
    const result: AuditResult = {
        checked: emptyCounts(),
        byPlatformAdmin: emptyCounts(),
        findings: [],
        tasksWithoutCircle: 0,
        notificationsForUnknownTasks: 0,
    };
    const tasksById = new Map<string, AuditTask>();

    const check = (task: AuditTask, kind: AuditKind, actor: Did | undefined, at?: Date) => {
        if (!actor) return;
        result.checked[kind] += 1;
        const taskId = String(task._id);
        if (actor === task.createdBy) return;
        const roles = task.circleId ? input.rolesByCircleId.get(String(task.circleId)) : undefined;
        if (roles && (roles.managers.has(actor) || roles.ownerDid === actor)) return;
        if (input.platformAdmins.has(actor)) {
            result.byPlatformAdmin[kind] += 1;
            return;
        }
        result.findings.push({
            kind,
            taskId,
            at,
            reason: roles?.members.has(actor) ? "member_not_manager" : "not_member",
        });
    };

    for (const task of input.tasks) {
        tasksById.set(String(task._id), task);
        if (!task.circleId) result.tasksWithoutCircle += 1;
        for (const participant of task.participants ?? []) {
            check(task, "shift_confirmation", participant.verifiedBy, participant.verifiedAt);
            check(task, "attendance", participant.attendanceVerifiedBy, participant.attendanceVerifiedAt);
        }
        for (const claim of task.claims ?? []) check(task, "claim_review", claim.reviewedBy, claim.reviewedAt);
        check(task, "claim_approval", task.claimApprovedBy, task.claimApprovedAt);
        check(task, "changes_requested", task.reviewRequestedChangesBy, task.reviewRequestedChangesAt);
        check(task, "completion_verified", task.verifiedBy, task.verifiedAt);
        // Accept and submit-for-review are the assignee's own; anyone else is odd on its own terms.
        for (const [kind, actor, at] of [
            ["accepted_not_assignee", task.acceptedBy, task.acceptedAt],
            ["submitted_not_assignee", task.submittedForReviewBy, task.submittedForReviewAt],
        ] as const) {
            if (!actor) continue;
            result.checked[kind] += 1;
            if (task.assignedTo && actor !== task.assignedTo) {
                result.findings.push({ kind, taskId: String(task._id), at, reason: "not_assignee" });
            }
        }
    }

    // One notification per recipient: count each (task, kind, actor, minute) once.
    const seen = new Set<string>();
    for (const notification of input.notifications) {
        const kind: AuditKind | undefined =
            notification.type === "task_assigned"
                ? "assignment"
                : notification.type === "task_status_changed"
                  ? "stage_change"
                  : undefined;
        if (!kind) continue;
        const taskId = notification.content?.taskId ? String(notification.content.taskId) : undefined;
        const actor = notification.content?.user?.did;
        if (!taskId || !actor) continue;
        const minute = notification.createdAt ? Math.floor(notification.createdAt.getTime() / 60000) : 0;
        const key = `${kind}|${taskId}|${actor}|${minute}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const task = tasksById.get(taskId);
        if (!task) {
            result.notificationsForUnknownTasks += 1;
            continue;
        }
        check(task, kind, actor, notification.createdAt);
    }

    return result;
};

// The printed report: counts, then task ids with kind, reason and date. No DIDs, names or places.
export const formatAuditReport = (result: AuditResult, totals: { tasks: number; notifications: number }): string => {
    const lines: string[] = [];
    lines.push(`Tasks read: ${totals.tasks}. Task notifications read: ${totals.notifications}.`);
    lines.push(`Tasks without a circleId: ${result.tasksWithoutCircle}.`);
    lines.push(
        `Assignment/stage notifications for tasks that no longer exist: ${result.notificationsForUnknownTasks}.`,
    );
    lines.push("");
    lines.push("kind                     checked  by-platform-admin  flagged");
    for (const kind of AUDIT_KINDS) {
        const flagged = result.findings.filter((finding) => finding.kind === kind).length;
        lines.push(
            `${kind.padEnd(24)} ${String(result.checked[kind]).padStart(7)}  ${String(result.byPlatformAdmin[kind]).padStart(17)}  ${String(flagged).padStart(7)}`,
        );
    }
    lines.push("");
    lines.push(`FLAGGED: ${result.findings.length}`);
    const sorted = [...result.findings].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
    for (const finding of sorted) {
        lines.push(
            `  task ${finding.taskId}  ${finding.kind}  ${finding.reason}  ${finding.at ? finding.at.toISOString() : "(no date)"}`,
        );
    }
    return lines.join("\n");
};
