// Which bell notices show the picture of the person who acted (with a small type icon), rather than
// the circle's picture. Moved out of notifications.tsx (2026-11-19) so it can be tested.
// task_shift_declined and task_claim_declined are not here: they show the circle's picture, not
// who declined (like crew_application_approved).
const ACTOR_PICTURE_NOTIFICATION_TYPES = new Set([
    "post_comment",
    "comment_reply",
    "post_mention",
    "comment_mention",
    "proposal_vote",
    "proposal_submitted_for_review",
    "issue_submitted_for_review",
    "issue_approved",
    "issue_assigned",
    "issue_status_changed",
    "task_submitted_for_review",
    "task_changes_requested",
    "task_verified",
    "task_approved",
    "task_assigned",
    "task_accepted",
    "task_shift_signup",
    "task_shift_confirmed",
    "task_shift_attendance_verified",
    "task_status_changed",
    "task_claim_submitted",
    "task_claim_approved",
]);

export const showsActorPicture = (notificationType: string): boolean =>
    ACTOR_PICTURE_NOTIFICATION_TYPES.has(notificationType);
