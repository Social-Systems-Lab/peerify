// Client-safe. Who may edit a task or shift (crew polish, 2026-11-25).
// Before: the author while it was in review, or Moderate Tasks (admins by default) until resolved.
// Tasks made by someone with Approve tasks now start open (createTaskAction), so a moderator would have
// lost editing their own task right at creation. The author may now also edit their own task until it's
// resolved if they hold Approve tasks (tasks.review: admins and moderators by default). Nobody edits a
// resolved task (the server always refused it). Changing a task's type stays review-only
// (updateTaskAction), since people may already have signed up or claimed it.

export type TaskEditRightsInput = {
    isAuthor: boolean;
    canReview: boolean;
    canModerate: boolean;
    stage: string | undefined;
};

export const canEditTask = ({ isAuthor, canReview, canModerate, stage }: TaskEditRightsInput): boolean => {
    if (stage === "resolved") return false;
    if (canModerate) return true;
    return isAuthor && (stage === "review" || canReview);
};
