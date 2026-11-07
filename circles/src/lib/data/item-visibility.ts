import type { Feature } from "@/models/models";
import { isAuthorized } from "@/lib/auth/auth";
import { Members } from "./db";
import { resolveViewerIsAdmin } from "./circle";

type VisibleItem = { createdBy?: string; assignedTo?: string; stage?: string; userGroups?: string[] };

/**
 * Issues and goals as a viewer may receive them (leak round 3, M9, 2026-11-07). Two rules were
 * enforced only in the browser, or not at all:
 * - review: an item in the "review" stage only for people with the review feature (issues: the UI
 *   filter in Issues.tsx). Pass it only where the review stage is hidden today.
 * - the item's audience (userGroups): an item whose groups don't include "everyone" only for
 *   members of one of those groups. The forms don't set it today, so stored items are open.
 * The item's author and assignee, the circle's moderators (moderateFeature) and platform admins
 * always get every item.
 */
export const filterItemsForViewer = async <T extends VisibleItem>(
    items: T[],
    viewerDid: string | undefined,
    circleId: string,
    options: { moderateFeature: Feature; reviewFeature?: Feature },
): Promise<T[]> => {
    const restricted = (item: T) =>
        (!!options.reviewFeature && item.stage === "review") ||
        (!!item.userGroups?.length && !item.userGroups.includes("everyone"));
    if (!items.some(restricted)) return items;
    if (await resolveViewerIsAdmin(viewerDid)) return items;
    if (viewerDid && (await isAuthorized(viewerDid, circleId, options.moderateFeature))) return items;

    const canReview =
        !!viewerDid && !!options.reviewFeature && (await isAuthorized(viewerDid, circleId, options.reviewFeature));
    const viewerGroups: string[] = viewerDid
        ? ((await Members.findOne({ userDid: viewerDid, circleId }, { projection: { userGroups: 1 } }))?.userGroups ?? [])
        : [];

    return items.filter((item) => {
        if (viewerDid && (item.createdBy === viewerDid || item.assignedTo === viewerDid)) return true;
        if (options.reviewFeature && item.stage === "review" && !canReview) return false;
        const audience = item.userGroups ?? [];
        if (audience.length && !audience.includes("everyone") && !audience.some((group) => viewerGroups.includes(group))) {
            return false;
        }
        return true;
    });
};
