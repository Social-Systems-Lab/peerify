import type { Circle } from "@/models/models";
import { isAuthorized } from "@/lib/auth/auth";
import { isFollowerListOwnerOnly } from "@/lib/peerify/follower-list";
import { AdminInvitations, Members } from "./db";
import { resolveViewerIsAdmin } from "./circle";
import { features } from "./constants";

/**
 * Who may see a circle's follower list (leak round 3, M2; Tim's decision D2, 2026-11-07):
 * - a personal profile: its owner only;
 * - a circle where following needs approval (isPublic not true, the same test followCircle uses):
 *   its followers (any membership) and platform admins, and someone with a pending admin
 *   invitation (the invitation is answered on the Followers page);
 * - any other circle: as before.
 * In every case except the owner-only one, the circle's own "View followers" rule applies too.
 */
export const canViewFollowerList = async (
    circle: Pick<Circle, "_id" | "did" | "circleType" | "isPublic">,
    viewerDid: string | undefined,
): Promise<boolean> => {
    if (isFollowerListOwnerOnly(circle)) return !!viewerDid && viewerDid === circle.did;
    const circleId = String(circle._id);
    if (await resolveViewerIsAdmin(viewerDid)) return true;
    if (!(await isAuthorized(viewerDid, circleId, features.followers.view))) return false;
    if (circle.isPublic === true) return true;
    if (!viewerDid) return false;
    if (await Members.findOne({ userDid: viewerDid, circleId }, { projection: { _id: 1 } })) return true;
    return !!(await AdminInvitations.findOne({ circleId, invitedUserDid: viewerDid, status: "pending" }));
};
