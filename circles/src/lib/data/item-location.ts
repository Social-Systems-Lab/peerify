import type { Feature, Location } from "@/models/models";
import { isAuthorized } from "@/lib/auth/auth";
import { redactLocationForViewer } from "@/lib/utils";
import { toPublicLocation } from "@/lib/utils/public-circle";
import { resolveViewerIsAdmin } from "./circle";

type LocatedItem = { location?: Location; createdBy?: string; assignedTo?: string };

/**
 * Issue and goal locations, shaped for the viewer (leak round 3, 2026-11-05). LocationPicker
 * defaults these to "Exact" and offers "use my location", and nothing redacted them, so anyone who
 * could view the issues or goals got the street and pin. Now the item's author, its assignee, the
 * circle's moderators (moderateFeature) and platform admins keep the stored location; everyone
 * else gets city level at most (street and pin dropped), as on public profiles.
 */
export const shapeItemLocationsForViewer = async <T extends LocatedItem>(
    items: T[],
    viewerDid: string | undefined,
    circleId: string,
    moderateFeature: Feature,
): Promise<T[]> => {
    if (!items.some((item) => item.location)) return items;
    const viewerIsAdmin = await resolveViewerIsAdmin(viewerDid);
    if (viewerIsAdmin || (viewerDid && (await isAuthorized(viewerDid, circleId, moderateFeature)))) {
        return items;
    }
    return items.map((item) => {
        if (!item.location) return item;
        if (viewerDid && (item.createdBy === viewerDid || item.assignedTo === viewerDid)) return item;
        return {
            ...item,
            location: toPublicLocation(redactLocationForViewer(item.location, item.createdBy, { viewerDid, viewerIsAdmin })),
        };
    });
};
