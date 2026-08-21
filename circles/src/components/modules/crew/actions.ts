"use server";

import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getMember, setCrewVisibility } from "@/lib/data/member";

// Crew-specific relationship-access check, modeled on getProfilePreviewAccessAction's shape but
// with different rules: Community's suppression (mapVisible/searchable) is per-account/global
// and bypassed by any follower or accepted contact; Crew's crewVisible is per-membership/scoped
// to this one circle's Crew, and only bypassed by that circle's own admins/moderators (or the
// member viewing their own row) — a peer Crew member elsewhere doesn't get a pass. The viewer's
// identity is derived from the auth cookie, not a client-supplied value.
export const getCrewProfileAccessAction = async (
    circleId: string,
    targetUserDid: string,
): Promise<{ hasAccess: boolean }> => {
    const viewerDid = await getAuthenticatedUserDid();
    if (!viewerDid || !circleId || !targetUserDid) {
        return { hasAccess: false };
    }
    if (viewerDid === targetUserDid) {
        return { hasAccess: true };
    }

    const viewerMember = await getMember(viewerDid, circleId);
    const isAdminOrMod = viewerMember?.userGroups?.some((group) => group === "admins" || group === "moderators") ?? false;

    return { hasAccess: isAdminOrMod };
};

type SetCrewVisibilityResponse = {
    success: boolean;
    message?: string;
};

export const setCrewVisibilityAction = async (
    circleId: string,
    crewVisible: boolean,
): Promise<SetCrewVisibilityResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to change your Crew visibility" };
    }

    try {
        await setCrewVisibility(userDid, circleId, crewVisible);
        return { success: true };
    } catch (error) {
        return { success: false, message: "Failed to update your Crew visibility. " + error?.toString() };
    }
};
