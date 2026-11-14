// Text of the Noticeboard post linked to a shift (tasks/actions.ts, upsertShiftNoticeboardPost).
// Kept out of the "use server" actions file, which may only export async functions.
import type { Task } from "@/models/models";

// The description only: "Important for participants" (participantNotes) is for people on the shift
// (D3, decision B), and the post goes to the circle's admins, moderators and members.
export const buildShiftNoticeboardPostContent = (task: Pick<Task, "description">) => {
    const detail = task.description.trim();
    return detail ? `Help with this volunteer shift. ${detail}` : "Help with this volunteer shift.";
};
