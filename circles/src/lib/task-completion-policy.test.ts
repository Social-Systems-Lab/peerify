import assert from "node:assert/strict";
import {
    buildOutcomeTaskCompletionUpdate,
    getOutcomeTaskCompletionPlan,
    type OutcomeTaskCompletionPermissions,
} from "./task-completion-policy";

const ordinaryUser: OutcomeTaskCompletionPermissions = {
    isAuthor: false,
    isAssignee: false,
    canAssign: false,
    canResolve: false,
    canModerate: false,
};

const moderator: OutcomeTaskCompletionPermissions = {
    isAuthor: false,
    isAssignee: false,
    canAssign: false,
    canResolve: false,
    canModerate: true,
};

const resolver: OutcomeTaskCompletionPermissions = {
    isAuthor: false,
    isAssignee: false,
    canAssign: false,
    canResolve: true,
    canModerate: false,
};

const authorOnly: OutcomeTaskCompletionPermissions = {
    isAuthor: true,
    isAssignee: false,
    canAssign: false,
    canResolve: false,
    canModerate: false,
};

const selfAuthorOnly: OutcomeTaskCompletionPermissions = {
    isAuthor: true,
    isAssignee: true,
    canAssign: false,
    canResolve: false,
    canModerate: false,
};

const selfAssigneeModerator: OutcomeTaskCompletionPermissions = {
    isAuthor: false,
    isAssignee: true,
    canAssign: false,
    canResolve: false,
    canModerate: true,
};

const selfAssigneeAssigner: OutcomeTaskCompletionPermissions = {
    isAuthor: false,
    isAssignee: true,
    canAssign: true,
    canResolve: false,
    canModerate: false,
};

const selfAssigneeResolver: OutcomeTaskCompletionPermissions = {
    isAuthor: false,
    isAssignee: true,
    canAssign: false,
    canResolve: true,
    canModerate: false,
};

const activeUnassignedOutcomeTask = {
    stage: "open",
    taskType: "outcome",
} as const;

assert.deepEqual(
    getOutcomeTaskCompletionPlan(activeUnassignedOutcomeTask, moderator),
    { allowed: true, mode: "unassigned-operational-completion" },
    "authorized moderators can complete unassigned outcome tasks",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(activeUnassignedOutcomeTask, resolver),
    { allowed: true, mode: "unassigned-operational-completion" },
    "authorized task resolvers can complete unassigned outcome tasks",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "inProgress",
            taskType: "outcome",
        },
        moderator,
    ),
    { allowed: true, mode: "unassigned-operational-completion" },
    "authorized moderators can complete unassigned in-progress outcome tasks",
);

assert.deepEqual(
    buildOutcomeTaskCompletionUpdate("did:example:moderator", new Date("2026-07-16T10:00:00.000Z")),
    {
        stage: "resolved",
        resolvedAt: new Date("2026-07-16T10:00:00.000Z"),
        verifiedAt: new Date("2026-07-16T10:00:00.000Z"),
        verifiedBy: "did:example:moderator",
    },
    "the actual admin/moderator DID is saved as the verifier",
);

assert.equal(
    Object.hasOwn(
        buildOutcomeTaskCompletionUpdate("did:example:moderator", new Date("2026-07-16T10:00:00.000Z")),
        "assignedTo",
    ),
    false,
    "unassigned operational completion does not add or require assignedTo",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(activeUnassignedOutcomeTask, ordinaryUser),
    { allowed: false, reason: "Not authorized to complete this task" },
    "ordinary users cannot complete unassigned outcome tasks",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(activeUnassignedOutcomeTask, authorOnly),
    { allowed: false, reason: "Not authorized to complete this task" },
    "task authors without task moderation authority cannot complete unassigned outcome tasks",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            ...activeUnassignedOutcomeTask,
            claims: [
                {
                    claimId: "claim-1",
                    claimantDid: "did:example:claimant",
                    status: "pending",
                    createdAt: new Date("2026-07-16T10:00:00.000Z"),
                },
            ],
        },
        moderator,
    ),
    { allowed: false, reason: "Only genuinely unassigned tasks can be marked complete" },
    "pending claims make unassigned completion ineligible",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            ...activeUnassignedOutcomeTask,
            claims: [
                {
                    claimId: "claim-1",
                    claimantDid: "did:example:claimant",
                    status: "approved",
                    createdAt: new Date("2026-07-16T10:00:00.000Z"),
                },
            ],
        },
        moderator,
    ),
    { allowed: false, reason: "Only genuinely unassigned tasks can be marked complete" },
    "approved claim remnants make unassigned completion ineligible",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            ...activeUnassignedOutcomeTask,
            claimApprovedAt: new Date("2026-07-16T10:00:00.000Z"),
            claimApprovedBy: "did:example:reviewer",
        },
        moderator,
    ),
    { allowed: false, reason: "Only genuinely unassigned tasks can be marked complete" },
    "approved assignment metadata remnants make unassigned completion ineligible",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            ...activeUnassignedOutcomeTask,
            acceptedAt: new Date("2026-07-16T10:00:00.000Z"),
            acceptedBy: "did:example:assignee",
        },
        moderator,
    ),
    { allowed: false, reason: "Only genuinely unassigned tasks can be marked complete" },
    "accepted assignment remnants make unassigned completion ineligible",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            ...activeUnassignedOutcomeTask,
            assignedTo: "did:example:assignee",
        },
        moderator,
    ),
    { allowed: false, reason: "Task must be submitted for review before it can be verified" },
    "assigned tasks do not use unassigned operational completion",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "inProgress",
            taskType: "outcome",
            assignedTo: "did:example:assignee",
        },
        moderator,
    ),
    { allowed: false, reason: "Task must be submitted for review before it can be verified" },
    "assigned tasks still require submission before verification",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "inProgress",
            taskType: "outcome",
            assignedTo: "did:example:assignee",
            submittedForReviewAt: new Date("2026-07-16T10:00:00.000Z"),
        },
        authorOnly,
    ),
    { allowed: true, mode: "assigned-verification" },
    "existing assigned-task verification remains allowed after submission",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "inProgress",
            taskType: "outcome",
            assignedTo: "did:example:author",
            submittedForReviewAt: new Date("2026-07-16T10:00:00.000Z"),
        },
        selfAuthorOnly,
    ),
    { allowed: false, reason: "Not authorized to verify this task" },
    "authors cannot self-verify their own assigned completion without independent task authority",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "inProgress",
            taskType: "outcome",
            assignedTo: "did:example:moderator",
            submittedForReviewAt: new Date("2026-07-16T10:00:00.000Z"),
        },
        moderator,
    ),
    { allowed: true, mode: "assigned-verification" },
    "authorized moderators can verify their own submitted task completion",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "inProgress",
            taskType: "outcome",
            assignedTo: "did:example:assignee",
            submittedForReviewAt: new Date("2026-07-16T10:00:00.000Z"),
        },
        selfAssigneeAssigner,
    ),
    { allowed: true, mode: "assigned-verification" },
    "authorized task assigners can verify their own submitted task completion",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "inProgress",
            taskType: "outcome",
            assignedTo: "did:example:assignee",
            submittedForReviewAt: new Date("2026-07-16T10:00:00.000Z"),
        },
        selfAssigneeResolver,
    ),
    { allowed: true, mode: "assigned-verification" },
    "authorized task resolvers can verify their own submitted task completion",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "inProgress",
            taskType: "outcome",
            assignedTo: "did:example:assignee",
            submittedForReviewAt: new Date("2026-07-16T10:00:00.000Z"),
        },
        selfAssigneeModerator,
    ),
    { allowed: true, mode: "assigned-verification" },
    "authorized task moderators can verify their own submitted task completion",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "inProgress",
            taskType: "outcome",
            assignedTo: "did:example:member",
            submittedForReviewAt: new Date("2026-07-16T10:00:00.000Z"),
        },
        ordinaryUser,
    ),
    { allowed: false, reason: "Not authorized to verify this task" },
    "ordinary users cannot self-verify just because they completed a task",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "resolved",
            taskType: "outcome",
            assignedTo: "did:example:assignee",
            verifiedAt: new Date("2026-07-16T10:00:00.000Z"),
        },
        ordinaryUser,
    ),
    { allowed: false, reason: "Not authorized to verify this task" },
    "unauthorized callers do not receive idempotent success for already completed assigned tasks",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "resolved",
            taskType: "outcome",
            verifiedAt: new Date("2026-07-16T10:00:00.000Z"),
        },
        ordinaryUser,
    ),
    { allowed: false, reason: "Not authorized to complete this task" },
    "unauthorized callers do not receive idempotent success for already completed unassigned tasks",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "open",
            taskType: "shift",
        },
        moderator,
    ),
    { allowed: false, reason: "Shift tasks are verified per participant" },
    "shift tasks remain excluded from outcome completion",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "resolved",
            taskType: "outcome",
            assignedTo: "did:example:assignee",
            verifiedAt: new Date("2026-07-16T10:00:00.000Z"),
        },
        authorOnly,
    ),
    { allowed: true, mode: "already-completed" },
    "authorized assigned-task reviewers keep idempotent success for already verified tasks",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "resolved",
            taskType: "outcome",
            verifiedAt: new Date("2026-07-16T10:00:00.000Z"),
        },
        moderator,
    ),
    { allowed: true, mode: "already-completed" },
    "already verified tasks return an idempotent completion plan",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "review",
            taskType: "outcome",
        },
        moderator,
    ),
    { allowed: false, reason: "Only active unassigned tasks can be marked complete" },
    "review-stage unassigned tasks cannot be marked complete",
);

assert.deepEqual(
    getOutcomeTaskCompletionPlan(
        {
            stage: "resolved",
            taskType: "outcome",
        },
        moderator,
    ),
    { allowed: false, reason: "Only active unassigned tasks can be marked complete" },
    "resolved unassigned tasks without verifiedAt cannot be marked complete again",
);

console.log("task-completion-policy tests passed");
