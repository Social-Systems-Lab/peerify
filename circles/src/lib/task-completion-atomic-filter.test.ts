import assert from "node:assert/strict";
import { buildOutcomeTaskCompletionAtomicFilter } from "./task-completion-policy";

const taskObjectId = { testObjectId: "task-1" };

assert.deepEqual(
    buildOutcomeTaskCompletionAtomicFilter({
        taskObjectId,
        circleId: "circle-1",
        mode: "unassigned-operational-completion",
    }),
    {
        _id: taskObjectId,
        circleId: "circle-1",
        verifiedAt: { $exists: false },
        $or: [{ taskType: { $exists: false } }, { taskType: "outcome" }],
        assignedTo: { $exists: false },
        acceptedAt: { $exists: false },
        acceptedBy: { $exists: false },
        claimApprovedAt: { $exists: false },
        claimApprovedBy: { $exists: false },
        claims: { $not: { $elemMatch: { status: { $in: ["pending", "approved"] } } } },
        stage: { $in: ["open", "inProgress"] },
    },
    "unassigned completion atomically requires same task/circle, unverified state, active stage, outcome type, and no assignment or claim remnants",
);

assert.deepEqual(
    buildOutcomeTaskCompletionAtomicFilter({
        taskObjectId,
        circleId: "circle-1",
        mode: "assigned-verification",
        expectedAssignedTo: "did:example:assignee",
    }),
    {
        _id: taskObjectId,
        circleId: "circle-1",
        verifiedAt: { $exists: false },
        $or: [{ taskType: { $exists: false } }, { taskType: "outcome" }],
        assignedTo: "did:example:assignee",
        stage: "inProgress",
        submittedForReviewAt: { $exists: true, $ne: null },
    },
    "assigned verification atomically requires same task/circle, same assignee, unverified state, in-progress stage, outcome type, and submitted review",
);

console.log("task-completion-atomic-filter tests passed");
