import type { TaskDisplay } from "@/models/models";

export type OutcomeTaskCompletionPermissions = {
    isAuthor: boolean;
    isAssignee: boolean;
    canAssign: boolean;
    canResolve: boolean;
    canModerate: boolean;
};

export type OutcomeTaskCompletionMode = "assigned-verification" | "unassigned-operational-completion";

export type OutcomeTaskCompletionPlan =
    | { allowed: true; mode: OutcomeTaskCompletionMode | "already-completed" }
    | { allowed: false; reason: string };

export const buildOutcomeTaskCompletionUpdate = (verifiedBy: string, verifiedAt: Date) => ({
    stage: "resolved" as const,
    resolvedAt: verifiedAt,
    verifiedAt,
    verifiedBy,
});

const hasTaskField = (
    task: Pick<
        TaskDisplay,
        "acceptedAt" | "acceptedBy" | "assignedTo" | "claimApprovedAt" | "claimApprovedBy" | "claims"
    >,
    field: "acceptedAt" | "acceptedBy" | "assignedTo" | "claimApprovedAt" | "claimApprovedBy",
) => Object.hasOwn(task, field);

export const hasGenuineUnassignedOutcomeState = (
    task: Pick<
        TaskDisplay,
        "acceptedAt" | "acceptedBy" | "assignedTo" | "claimApprovedAt" | "claimApprovedBy" | "claims"
    >,
) => {
    if (
        hasTaskField(task, "assignedTo") ||
        hasTaskField(task, "acceptedAt") ||
        hasTaskField(task, "acceptedBy") ||
        hasTaskField(task, "claimApprovedAt") ||
        hasTaskField(task, "claimApprovedBy")
    ) {
        return false;
    }

    return !(task.claims ?? []).some((claim) => claim.status === "pending" || claim.status === "approved");
};

export const buildOutcomeTaskCompletionAtomicFilter = ({
    taskObjectId,
    circleId,
    mode,
    expectedAssignedTo,
}: {
    taskObjectId: unknown;
    circleId: string;
    mode: OutcomeTaskCompletionMode;
    expectedAssignedTo?: string;
}) => {
    const filter: Record<string, unknown> = {
        _id: taskObjectId,
        circleId,
        verifiedAt: { $exists: false },
        $or: [{ taskType: { $exists: false } }, { taskType: "outcome" }],
    };

    if (mode === "assigned-verification") {
        return {
            ...filter,
            assignedTo: expectedAssignedTo,
            stage: "inProgress",
            submittedForReviewAt: { $exists: true, $ne: null },
        };
    }

    return {
        ...filter,
        assignedTo: { $exists: false },
        acceptedAt: { $exists: false },
        acceptedBy: { $exists: false },
        claimApprovedAt: { $exists: false },
        claimApprovedBy: { $exists: false },
        claims: { $not: { $elemMatch: { status: { $in: ["pending", "approved"] } } } },
        stage: { $in: ["open", "inProgress"] },
    };
};

export const getOutcomeTaskCompletionPlan = (
    task: Pick<
        TaskDisplay,
        | "acceptedAt"
        | "acceptedBy"
        | "assignedTo"
        | "claimApprovedAt"
        | "claimApprovedBy"
        | "claims"
        | "stage"
        | "submittedForReviewAt"
        | "taskType"
        | "verifiedAt"
    >,
    permissions: OutcomeTaskCompletionPermissions,
): OutcomeTaskCompletionPlan => {
    if ((task.taskType ?? "outcome") === "shift") {
        return { allowed: false, reason: "Shift tasks are verified per participant" };
    }

    const hasIndependentReviewAuthority =
        permissions.canAssign || permissions.canResolve || permissions.canModerate;
    const canManageAssignedReview =
        hasIndependentReviewAuthority || (permissions.isAuthor && !permissions.isAssignee);

    if (!hasTaskField(task, "assignedTo")) {
        if (!hasIndependentReviewAuthority) {
            return { allowed: false, reason: "Not authorized to complete this task" };
        }

        if (!hasGenuineUnassignedOutcomeState(task)) {
            return { allowed: false, reason: "Only genuinely unassigned tasks can be marked complete" };
        }

        if (task.stage === "resolved" && task.verifiedAt) {
            return { allowed: true, mode: "already-completed" };
        }

        if (task.stage !== "open" && task.stage !== "inProgress") {
            return { allowed: false, reason: "Only active unassigned tasks can be marked complete" };
        }

        return { allowed: true, mode: "unassigned-operational-completion" };
    }

    if (!canManageAssignedReview) {
        return { allowed: false, reason: "Not authorized to verify this task" };
    }

    if (task.stage === "resolved" && task.verifiedAt) {
        return { allowed: true, mode: "already-completed" };
    }

    if (task.stage !== "inProgress" || !task.submittedForReviewAt) {
        return { allowed: false, reason: "Task must be submitted for review before it can be verified" };
    }

    return { allowed: true, mode: "assigned-verification" };
};
