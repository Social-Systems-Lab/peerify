import type { Circle } from "@/models/models";
import { isProfileCirclesListOwnerOnly } from "@/lib/peerify/profile-circles-list";
import { resolveViewerIsAdmin } from "./circle";

/**
 * Who may see a personal profile's Circles list (the page, its data and the /api/access route
 * guard): the profile's owner and platform admins (Tim, 2026-11-15). Any other circle: unchanged,
 * its own access rules decide. See lib/peerify/profile-circles-list.ts.
 */
export const canViewProfileCirclesList = async (
    circle: Pick<Circle, "circleType" | "did">,
    viewerDid: string | undefined,
): Promise<boolean> => {
    if (!isProfileCirclesListOwnerOnly(circle)) return true;
    if (!viewerDid) return false;
    if (viewerDid === circle.did) return true;
    return resolveViewerIsAdmin(viewerDid);
};
