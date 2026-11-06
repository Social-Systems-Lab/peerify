// Who reviews Crew applications, and the pending count on the Crew Dashboard button.
// Applications are reviewed on the Crew Dashboard (settings/crew), which needs edit_about, under
// /settings, which the middleware gates on settings.view (both default admins). Managing
// applications needs manage_crew_applications (default admins and moderators). Only people with
// both are notified (Tim, 2026-11-06), so every notification's Review button opens a page its
// recipient can use.
import { getAuthorizedMembers, isAuthorized } from "@/lib/auth/auth";
import { Circle } from "@/models/models";
import { features } from "./constants";
import { getAllCrewApplications } from "./crew-applications";

export const getCrewApplicationReviewers = async (circle: Circle): Promise<Circle[]> => {
    const circleId = circle._id ?? "";
    if (!circleId) return [];
    const managers = await getAuthorizedMembers(circle, features.general.manage_crew_applications);
    const reviewers: Circle[] = [];
    for (const manager of managers) {
        if (manager.did && (await isAuthorized(manager.did, circleId, features.settings.edit_about))) {
            reviewers.push(manager);
        }
    }
    return reviewers;
};

// The badge on the Crew Dashboard button. 0 for anyone who can't manage applications. Counted
// from the same list the Dashboard shows, so the badge and the list always agree.
export const getPendingCrewApplicationCountForViewer = async (
    viewerDid: string | undefined | null,
    circleId: string | undefined,
): Promise<number> => {
    if (!viewerDid || !circleId) return 0;
    if (!(await isAuthorized(viewerDid, circleId, features.general.manage_crew_applications))) return 0;
    const { pendingApplications } = await getAllCrewApplications(circleId);
    return pendingApplications.length;
};
