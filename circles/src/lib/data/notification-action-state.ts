// Pure: no database, no I/O. Whether a task notice still needs its recipient to act (backlog
// item 3, 2026-11-25). Worked out each time the bell loads, from the task as it is now, rather
// than stored on the notice: the claim can be approved on the task page or by another organiser,
// the task reassigned or deleted, and every one of those would otherwise need its own hook (and
// notices from before today would never clear).
//
//  - task_claim_submitted (to organisers): needed while the claimant's claim is still pending on an
//    open, unassigned task. A task holds at most one pending claim per claimant (submitTaskClaim's
//    update refuses a second), so the claimant's did (content.user.did) finds the claim, and its
//    claimId is returned for the bell's Approve button. Notices don't store a claimId.
//  - task_assigned, task_claim_approved (to the assignee): needed while the task is open, still
//    assigned to the recipient and not yet accepted. The same test as the task page's
//    "Confirm I'll do this" / "Accept Task" button (task-detail.tsx).
//
// Only `needed` and, for a claim, its id go back to the browser: nothing else from the task.

export type TaskActionFacts = {
    _id: string;
    stage?: string;
    taskType?: string;
    assignedTo?: string;
    acceptedBy?: string;
    claims?: { claimId?: string; claimantDid?: string; status?: string }[];
};

export type TaskNoticeAction = { needed: boolean; claimId?: string };

export const CLAIM_REVIEW_NOTICE_TYPES = new Set(["task_claim_submitted"]);
export const ASSIGNEE_CONFIRM_NOTICE_TYPES = new Set(["task_assigned", "task_claim_approved"]);

export const isTaskActionNoticeType = (type: string): boolean =>
    CLAIM_REVIEW_NOTICE_TYPES.has(type) || ASSIGNEE_CONFIRM_NOTICE_TYPES.has(type);

const isOutcomeTask = (task: TaskActionFacts): boolean => (task.taskType ?? "outcome") === "outcome";

export const getTaskNoticeAction = (
    type: string,
    content: Record<string, any> | undefined,
    task: TaskActionFacts | undefined,
    recipientDid: string,
): TaskNoticeAction | undefined => {
    if (!isTaskActionNoticeType(type)) {
        return undefined;
    }
    if (!task || task.stage !== "open" || !isOutcomeTask(task)) {
        return { needed: false };
    }

    if (CLAIM_REVIEW_NOTICE_TYPES.has(type)) {
        const claimantDid = content?.user?.did;
        if (typeof claimantDid !== "string" || task.assignedTo) {
            return { needed: false };
        }
        const pending = (task.claims ?? []).find(
            (claim) => claim.claimantDid === claimantDid && claim.status === "pending" && claim.claimId,
        );
        return pending ? { needed: true, claimId: String(pending.claimId) } : { needed: false };
    }

    return { needed: task.assignedTo === recipientDid && !task.acceptedBy };
};

// The task ids the bell's page of notices needs, for one lookup.
export const getTaskIdsForActionNotices = (notices: { type: string; content?: Record<string, any> }[]): string[] => {
    const ids = new Set<string>();
    for (const notice of notices) {
        const taskId = notice.content?.taskId;
        if (isTaskActionNoticeType(notice.type) && typeof taskId === "string" && /^[0-9a-f]{24}$/i.test(taskId)) {
            ids.add(taskId);
        }
    }
    return [...ids];
};

// Adds `taskAction` to each task notice that can need action; other notices are returned as they are.
export const withTaskNoticeActions = <T extends { type: string; content?: Record<string, any> }>(
    notices: T[],
    tasks: TaskActionFacts[],
    recipientDid: string,
): (T & { taskAction?: TaskNoticeAction })[] => {
    const byId = new Map(tasks.map((task) => [String(task._id), task]));
    return notices.map((notice) => {
        const taskAction = getTaskNoticeAction(
            notice.type,
            notice.content,
            byId.get(String(notice.content?.taskId ?? "")),
            recipientDid,
        );
        return taskAction ? { ...notice, taskAction } : notice;
    });
};
