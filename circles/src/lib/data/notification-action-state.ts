// Pure: no database, no I/O. Whether a notice still needs its recipient to act (backlog item 3,
// 2026-11-25; every decision notice, crew polish 2026-11-25). Each notice type that asks its
// recipient to decide something has one rule below, reading facts loaded once per bell load
// (loadNoticeFacts in notifications.ts). Worked out each time the bell loads, from the task as it is now, rather
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
// Only `needed` and, for a claim, its id go back to the browser: nothing else from the records.

export type TaskActionFacts = {
    _id: string;
    stage?: string;
    taskType?: string;
    assignedTo?: string;
    acceptedBy?: string;
    claims?: { claimId?: string; claimantDid?: string; status?: string }[];
};

export type NoticeAction = { needed: boolean; claimId?: string };

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
): NoticeAction | undefined => {
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

// --- Every notice type ---------------------------------------------------------------------------

type NoticeContent = Record<string, any> | undefined;
type Notice = { type: string; content?: NoticeContent };

// What the rules read, loaded once per bell load for the notices on the page.
export type NoticeFacts = {
    tasks: TaskActionFacts[];
};

export const emptyNoticeFacts = (): NoticeFacts => ({ tasks: [] });

const OBJECT_ID = /^[0-9a-f]{24}$/i;
export const isObjectIdString = (value: unknown): value is string => typeof value === "string" && OBJECT_ID.test(value);

type IndexedFacts = {
    tasksById: Map<string, TaskActionFacts>;
};

const indexFacts = (facts: NoticeFacts): IndexedFacts => ({
    tasksById: new Map(facts.tasks.map((task) => [String(task._id), task])),
});

type Rule = (content: NoticeContent, facts: IndexedFacts, recipientDid: string, type: string) => NoticeAction;

const taskRule: Rule = (content, facts, recipientDid, type) =>
    getTaskNoticeAction(type, content, facts.tasksById.get(String(content?.taskId ?? "")), recipientDid) ?? {
        needed: false,
    };

const RULES: Record<string, Rule> = {
    task_claim_submitted: taskRule,
    task_assigned: taskRule,
    task_claim_approved: taskRule,
};

export const isActionNoticeType = (type: string): boolean => type in RULES;

export const getNoticeAction = (
    type: string,
    content: NoticeContent,
    facts: NoticeFacts,
    recipientDid: string,
): NoticeAction | undefined => {
    const rule = RULES[type];
    return rule ? rule(content, indexFacts(facts), recipientDid, type) : undefined;
};

// What to look up for this page of notices: one query per kind, only for the types present.
export type NoticeLookups = {
    taskIds: string[];
};

export const getNoticeLookups = (notices: Notice[]): NoticeLookups => {
    const taskIds = new Set<string>();
    for (const notice of notices) {
        const content = notice.content;
        if (isTaskActionNoticeType(notice.type) && isObjectIdString(content?.taskId)) {
            taskIds.add(content.taskId);
        }
    }
    return { taskIds: [...taskIds] };
};

export const hasNoticeLookups = (lookups: NoticeLookups): boolean => lookups.taskIds.length > 0;

// Adds `action` to each notice that can need action; other notices are returned as they are.
export const withNoticeActions = <T extends Notice>(
    notices: T[],
    facts: NoticeFacts,
    recipientDid: string,
): (T & { action?: NoticeAction })[] => {
    const indexed = indexFacts(facts);
    return notices.map((notice) => {
        const rule = RULES[notice.type];
        if (!rule) return notice;
        return { ...notice, action: rule(notice.content, indexed, recipientDid, notice.type) };
    });
};
