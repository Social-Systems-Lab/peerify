import type { Circle } from "@/models/models";
import { isAuthorized } from "@/lib/auth/auth";
import { isFollowerListOwnerOnly } from "@/lib/peerify/follower-list";
import { AdminInvitations, Members } from "./db";
import { resolveViewerIsAdmin } from "./circle";
import { features } from "./constants";

/**
 * Who may see a circle's follower list (Tim's decision 2026-11-07, privacy by default, replacing
 * D2's "open circles stay public"):
 * - a personal profile: its owner only;
 * - any other circle: its admins and platform admins always; its moderators when the circle's own
 *   "View followers" rule lets them (the rule can still narrow the list to admins; it can no
 *   longer open it to followers or the public).
 * Everyone else, logged out too, sees only the follower count.
 */
export const canViewFollowerList = async (
    circle: Pick<Circle, "_id" | "did" | "circleType">,
    viewerDid: string | undefined,
): Promise<boolean> => {
    if (!viewerDid) return false;
    if (isFollowerListOwnerOnly(circle)) return viewerDid === circle.did;
    const circleId = String(circle._id);
    if (await resolveViewerIsAdmin(viewerDid)) return true;
    const member = await Members.findOne({ userDid: viewerDid, circleId }, { projection: { userGroups: 1 } });
    const groups: string[] = member?.userGroups ?? [];
    if (groups.includes("admins")) return true;
    if (!groups.includes("moderators")) return false;
    return await isAuthorized(viewerDid, circleId, features.followers.view);
};

/**
 * Someone with a pending admin invitation answers it on the Followers page (the banner), so they
 * may open that page, but they don't get the list.
 */
export const hasPendingAdminInvitation = async (
    circle: Pick<Circle, "_id" | "circleType">,
    viewerDid: string | undefined,
): Promise<boolean> => {
    if (!viewerDid || isFollowerListOwnerOnly(circle)) return false;
    return !!(await AdminInvitations.findOne({
        circleId: String(circle._id),
        invitedUserDid: viewerDid,
        status: "pending",
    }));
};
