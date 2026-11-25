// Pure: no database, no I/O. Whether a notice still needs its recipient to act (backlog item 3,
// 2026-11-25; widened to every decision notice in the crew polish, 2026-11-25). Each notice type
// that asks its recipient to decide something has one rule below, reading facts loaded once per bell
// load (loadNoticeFacts in notifications.ts). It's worked out each time from the records as they are
// now, rather than stored on the notice: the decision can be made on another page or by another
// organiser, the item changed or deleted, and every one of those would otherwise need its own hook
// (and notices from before would never clear).
//
// Task notices:
//  - task_claim_submitted (to organisers): needed while the claimant's claim is still pending on an
//    open, unassigned task. A task holds at most one pending claim per claimant (submitTaskClaim's
//    update refuses a second), so the claimant's did (content.user.did) finds the claim, and its
//    claimId is returned for the bell's Approve button. Notices don't store a claimId.
//  - task_assigned, task_claim_approved (to the assignee): needed while the task is open, still
//    assigned to the recipient and not yet accepted. The same test as the task page's
//    "Confirm I'll do this" / "Accept Task" button (task-detail.tsx).
//  - task_shift_signup (to organisers): needed while the person who signed up (content.user.did) is
//    still a participant with no verifiedAt on a shift that isn't resolved. Confirming sets
//    verifiedAt; declining or leaving removes the participant.
//  - task_submitted_for_review (to reviewers, resolvers and the author): one type, two meanings. A new
//    task waiting for approval (stage "review"), or finished work waiting to be verified
//    (submittedForReviewAt set, verifiedAt not, not resolved; requesting changes clears
//    submittedForReviewAt). The author can verify too (getOutcomeTaskCompletionPlan).
//
// Only `needed` and, for a claim, its id go back to the browser: nothing else from the records.

export type TaskActionFacts = {
    _id: string;
    stage?: string;
    taskType?: string;
    assignedTo?: string;
    acceptedBy?: string;
    claims?: { claimId?: string; claimantDid?: string; status?: string }[];
    participants?: { userDid?: string; verifiedAt?: Date | string | null }[];
    submittedForReviewAt?: Date | string | null;
    verifiedAt?: Date | string | null;
};

export type NoticeAction = { needed: boolean; claimId?: string };

export const CLAIM_REVIEW_NOTICE_TYPES = new Set(["task_claim_submitted"]);
export const ASSIGNEE_CONFIRM_NOTICE_TYPES = new Set(["task_assigned", "task_claim_approved"]);
const SHIFT_SIGNUP_NOTICE_TYPE = "task_shift_signup";
const TASK_REVIEW_NOTICE_TYPE = "task_submitted_for_review";

export const isTaskActionNoticeType = (type: string): boolean =>
    CLAIM_REVIEW_NOTICE_TYPES.has(type) ||
    ASSIGNEE_CONFIRM_NOTICE_TYPES.has(type) ||
    type === SHIFT_SIGNUP_NOTICE_TYPE ||
    type === TASK_REVIEW_NOTICE_TYPE;

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
    if (!task) {
        return { needed: false };
    }

    if (type === SHIFT_SIGNUP_NOTICE_TYPE) {
        const participantDid = content?.user?.did;
        if (typeof participantDid !== "string" || task.taskType !== "shift" || task.stage === "resolved") {
            return { needed: false };
        }
        return {
            needed: (task.participants ?? []).some(
                (participant) => participant.userDid === participantDid && !participant.verifiedAt,
            ),
        };
    }

    if (type === TASK_REVIEW_NOTICE_TYPE) {
        if (task.stage === "review") {
            return { needed: true };
        }
        return { needed: !!task.submittedForReviewAt && !task.verifiedAt && task.stage !== "resolved" };
    }

    if (task.stage !== "open" || !isOutcomeTask(task)) {
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
// `resolution` is top level on a stored notice (contact requests), not in content.
type Notice = { type: string; content?: NoticeContent; resolution?: string };

// A pending request from one person to one circle (a Crew application or a follow request).
export type PendingRequestFacts = { circleId: string; userDid: string };

// A pending admin invitation (AdminInvitations), by id and by circle + invitee.
export type PendingInvitationFacts = { _id: string; circleId: string; invitedUserDid: string };

// An event, for invitations: still open and not started.
export type EventFacts = { _id: string; stage?: string; startAt?: Date | string };

// What the rules read, loaded once per bell load for the notices on the page.
export type NoticeFacts = {
    tasks: TaskActionFacts[];
    pendingCrewApplications: PendingRequestFacts[];
    pendingMembershipRequests: PendingRequestFacts[];
    pendingAdminInvitations: PendingInvitationFacts[];
    // Events with a pending host-change request (one per event at most).
    pendingHostChangeEventIds: string[];
    events: EventFacts[];
    // Events the recipient has answered (an RSVP of any status).
    rsvpEventIds: string[];
    now: Date;
};

export const emptyNoticeFacts = (now: Date = new Date()): NoticeFacts => ({
    tasks: [],
    pendingCrewApplications: [],
    pendingMembershipRequests: [],
    pendingAdminInvitations: [],
    pendingHostChangeEventIds: [],
    events: [],
    rsvpEventIds: [],
    now,
});

const requestKey = (circleId: unknown, userDid: unknown) => `${String(circleId)}|${String(userDid)}`;
// The circle and the person a request notice is about: content.circle and content.user.
const requestOf = (content: NoticeContent) => {
    const circleId = content?.circle?._id;
    const userDid = content?.user?.did;
    return circleId && typeof userDid === "string" ? { circleId: String(circleId), userDid } : null;
};

const OBJECT_ID = /^[0-9a-f]{24}$/i;
export const isObjectIdString = (value: unknown): value is string => typeof value === "string" && OBJECT_ID.test(value);

type IndexedFacts = {
    tasksById: Map<string, TaskActionFacts>;
    pendingCrewApplications: Set<string>;
    pendingMembershipRequests: Set<string>;
    pendingInvitationIds: Set<string>;
    pendingInvitationsByCircleAndInvitee: Set<string>;
    pendingHostChangeEventIds: Set<string>;
    eventsById: Map<string, EventFacts>;
    rsvpEventIds: Set<string>;
    now: Date;
};

const indexFacts = (facts: NoticeFacts): IndexedFacts => ({
    tasksById: new Map(facts.tasks.map((task) => [String(task._id), task])),
    pendingCrewApplications: new Set(facts.pendingCrewApplications.map((r) => requestKey(r.circleId, r.userDid))),
    pendingMembershipRequests: new Set(facts.pendingMembershipRequests.map((r) => requestKey(r.circleId, r.userDid))),
    pendingInvitationIds: new Set(facts.pendingAdminInvitations.map((i) => String(i._id))),
    pendingInvitationsByCircleAndInvitee: new Set(
        facts.pendingAdminInvitations.map((i) => requestKey(i.circleId, i.invitedUserDid)),
    ),
    pendingHostChangeEventIds: new Set(facts.pendingHostChangeEventIds.map(String)),
    eventsById: new Map(facts.events.map((event) => [String(event._id), event])),
    rsvpEventIds: new Set(facts.rsvpEventIds.map(String)),
    now: facts.now,
});

type Rule = (notice: Notice, facts: IndexedFacts, recipientDid: string) => NoticeAction;

const taskRule: Rule = (notice, facts, recipientDid) =>
    getTaskNoticeAction(
        notice.type,
        notice.content,
        facts.tasksById.get(String(notice.content?.taskId ?? "")),
        recipientDid,
    ) ?? { needed: false };

// crew_application (to reviewers): the applicant still has a pending application to that circle.
// follow_request (to admins): the person still has a pending request to follow that circle.
const pendingRequestRule =
    (pick: (facts: IndexedFacts) => Set<string>): Rule =>
    (notice, facts) => {
        const request = requestOf(notice.content);
        return { needed: !!request && pick(facts).has(requestKey(request.circleId, request.userDid)) };
    };

// contact_request_received: open until it has a resolution, which is stored on the notice whichever
// surface the request was answered or withdrawn from (resolveConnectionRequestNotifications).
const contactRequestRule: Rule = (notice) => ({ needed: !notice.resolution });

// admin_invitation_received (to the invitee): the invitation (content.invitationId) is still pending.
// Notices from before invitationId was stored: a pending invitation to that circle for the recipient.
const adminInvitationRule: Rule = (notice, facts, recipientDid) => {
    const invitationId = notice.content?.invitationId;
    if (isObjectIdString(invitationId)) {
        return { needed: facts.pendingInvitationIds.has(invitationId) };
    }
    const circleId = notice.content?.circle?._id;
    return { needed: !!circleId && facts.pendingInvitationsByCircleAndInvitee.has(requestKey(circleId, recipientDid)) };
};

// event_host_change_requested (to the requested host's admins): the event's request is still pending
// (at most one pending request per event, createEventHostChangeRequest).
const hostChangeRule: Rule = (notice, facts) => ({
    needed: facts.pendingHostChangeEventIds.has(String(notice.content?.eventId ?? "")),
});

// event_invitation (to the guest): not answered yet, on an event that's still open and hasn't started.
// The invitation's own status is never updated after it's sent (nothing writes EventInvitations
// after insert), so the guest's RSVP is what says they've decided: any RSVP status counts.
const eventInvitationRule: Rule = (notice, facts) => {
    const eventId = String(notice.content?.eventId ?? "");
    const event = facts.eventsById.get(eventId);
    if (!event || event.stage !== "open" || !event.startAt || new Date(event.startAt) <= facts.now) {
        return { needed: false };
    }
    return { needed: !facts.rsvpEventIds.has(eventId) };
};

const RULES: Record<string, Rule> = {
    task_claim_submitted: taskRule,
    task_assigned: taskRule,
    task_claim_approved: taskRule,
    task_shift_signup: taskRule,
    task_submitted_for_review: taskRule,
    crew_application: pendingRequestRule((facts) => facts.pendingCrewApplications),
    follow_request: pendingRequestRule((facts) => facts.pendingMembershipRequests),
    contact_request_received: contactRequestRule,
    admin_invitation_received: adminInvitationRule,
    event_host_change_requested: hostChangeRule,
    event_invitation: eventInvitationRule,
};

export const isActionNoticeType = (type: string): boolean => type in RULES;

export const getNoticeAction = (notice: Notice, facts: NoticeFacts, recipientDid: string): NoticeAction | undefined => {
    const rule = RULES[notice.type];
    return rule ? rule(notice, indexFacts(facts), recipientDid) : undefined;
};

// What to look up for this page of notices: one query per kind, only for the types present.
// Request lookups list the circles and people; the query matches pending rows with both in the lists.
export type RequestLookup = { circleIds: string[]; userDids: string[] };

export type NoticeLookups = {
    taskIds: string[];
    crewApplications: RequestLookup;
    membershipRequests: RequestLookup;
    // Admin invitations by id, and (older notices) by circle for the recipient.
    adminInvitationIds: string[];
    adminInvitationCircleIds: string[];
    hostChangeEventIds: string[];
    invitationEventIds: string[];
};

const collectRequest = (lookup: { circleIds: Set<string>; userDids: Set<string> }, content: NoticeContent) => {
    const request = requestOf(content);
    if (request) {
        lookup.circleIds.add(request.circleId);
        lookup.userDids.add(request.userDid);
    }
};
const toLookup = (lookup: { circleIds: Set<string>; userDids: Set<string> }): RequestLookup => ({
    circleIds: [...lookup.circleIds],
    userDids: [...lookup.userDids],
});

export const getNoticeLookups = (notices: Notice[]): NoticeLookups => {
    const taskIds = new Set<string>();
    const crew = { circleIds: new Set<string>(), userDids: new Set<string>() };
    const follow = { circleIds: new Set<string>(), userDids: new Set<string>() };
    const adminInvitationIds = new Set<string>();
    const adminInvitationCircleIds = new Set<string>();
    const hostChangeEventIds = new Set<string>();
    const invitationEventIds = new Set<string>();
    for (const notice of notices) {
        const content = notice.content;
        if (isTaskActionNoticeType(notice.type) && isObjectIdString(content?.taskId)) {
            taskIds.add(content.taskId);
        } else if (notice.type === "crew_application") {
            collectRequest(crew, content);
        } else if (notice.type === "follow_request") {
            collectRequest(follow, content);
        } else if (notice.type === "admin_invitation_received") {
            if (isObjectIdString(content?.invitationId)) adminInvitationIds.add(content.invitationId);
            else if (content?.circle?._id) adminInvitationCircleIds.add(String(content.circle._id));
        } else if (notice.type === "event_host_change_requested") {
            if (content?.eventId) hostChangeEventIds.add(String(content.eventId));
        } else if (notice.type === "event_invitation") {
            if (isObjectIdString(content?.eventId)) invitationEventIds.add(content.eventId);
        }
    }
    return {
        taskIds: [...taskIds],
        crewApplications: toLookup(crew),
        membershipRequests: toLookup(follow),
        adminInvitationIds: [...adminInvitationIds],
        adminInvitationCircleIds: [...adminInvitationCircleIds],
        hostChangeEventIds: [...hostChangeEventIds],
        invitationEventIds: [...invitationEventIds],
    };
};

export const hasNoticeLookups = (lookups: NoticeLookups): boolean =>
    lookups.taskIds.length > 0 ||
    lookups.crewApplications.circleIds.length > 0 ||
    lookups.membershipRequests.circleIds.length > 0 ||
    lookups.adminInvitationIds.length > 0 ||
    lookups.adminInvitationCircleIds.length > 0 ||
    lookups.hostChangeEventIds.length > 0 ||
    lookups.invitationEventIds.length > 0;

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
        return { ...notice, action: rule(notice, indexed, recipientDid) };
    });
};
