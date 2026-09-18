import { Circle, UserPrivate } from "@/models/models";
import { sendNotifications } from "./notifications";
import { getUserPrivate } from "./user";
import { sanitizeObjectForJSON } from "../utils/sanitize";

// Offered userGroup handles resolved to their circle-configured display titles (e.g. "admins" ->
// "Admin"), same lookup members-table.tsx's userGroups column does - the notification body should
// read the same role names an admin sees anywhere else in the UI, not raw handles.
const resolveRoleNames = (circle: Circle, userGroups: string[]): string =>
    userGroups.map((handle) => circle.userGroups?.find((g) => g.handle === handle)?.title || handle).join(", ");

export async function notifyAdminInvitationReceived(
    circle: Circle,
    inviter: Circle,
    invitedUser: UserPrivate,
    userGroups: string[],
): Promise<void> {
    try {
        await sendNotifications(
            "admin_invitation_received",
            [invitedUser],
            sanitizeObjectForJSON({
                circle,
                user: inviter,
                roleNames: resolveRoleNames(circle, userGroups),
            }),
        );
    } catch (err) {
        console.error("Error in notifyAdminInvitationReceived:", err);
    }
}

export async function notifyAdminInvitationDecided(
    circle: Circle,
    invitee: Circle,
    inviterDid: string,
    userGroups: string[],
    accepted: boolean,
): Promise<void> {
    try {
        const inviter = await getUserPrivate(inviterDid);
        if (!inviter) return;

        await sendNotifications(
            "admin_invitation_decided",
            [inviter],
            sanitizeObjectForJSON({
                circle,
                user: invitee,
                roleNames: resolveRoleNames(circle, userGroups),
                accepted,
            }),
        );
    } catch (err) {
        console.error("Error in notifyAdminInvitationDecided:", err);
    }
}
