// The bell's action button: its label and its look, per notification type. Moved out of
// notifications.tsx (2026-11-25, backlog item 3) so they can be tested, as notification-avatar.ts
// was. No change: a notice with no link gets no button.

export const getNotificationActionLabel = (notificationType: string, href: string | null): string | null => {
    if (!href) {
        return null;
    }

    switch (notificationType) {
        case "contact_request_received":
            return "Respond";
        case "contact_request_accepted":
            return "Message";
        case "pm_received":
            return "Reply";
        case "task_assigned":
        case "task_shift_signup":
            return "Review";
        case "user_verification_request":
        case "user_verification_reply_received":
        case "event_host_change_requested":
        case "crew_application":
        case "admin_invitation_received":
            return "Review";
        case "admin_invitation_decided":
            return "View";
        case "crew_application_approved":
            return "View Crew";
        case "crew_broadcast":
            return "View Broadcast";
        case "user_verification_clarification_requested":
            return "Respond";
        case "task_shift_confirmed":
            return "Open";
        case "task_accepted":
            return "View";
        case "task_shift_attendance_verified":
        case "task_changes_requested":
        case "task_verified":
        case "task_claim_approved":
        case "task_claim_declined":
        case "task_shift_declined":
        case "post_comment":
        case "comment_reply":
        case "post_mention":
        case "comment_mention":
        case "track_comment":
        case "task_status_changed":
        case "task_approved":
        case "task_submitted_for_review":
        case "task_claim_submitted":
        case "issue_assigned":
        case "issue_status_changed":
        case "issue_approved":
        case "issue_submitted_for_review":
        case "goal_status_changed":
        case "goal_approved":
        case "goal_submitted_for_review":
        case "proposal_submitted_for_review":
        case "proposal_moved_to_voting":
        case "proposal_approved_for_voting":
        case "proposal_resolved":
            return "View";
        default:
            return null;
    }
};

const PRIMARY_ACTION_CLASS =
    "ml-2 rounded-full bg-amber-500 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-amber-600";
const DEFAULT_ACTION_CLASS = "ml-2 rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-gray-100";

export const getNotificationActionClassName = (notificationType: string): string =>
    notificationType === "contact_request_received" ? PRIMARY_ACTION_CLASS : DEFAULT_ACTION_CLASS;
