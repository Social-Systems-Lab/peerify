// Client-safe helpers about a circle's creator (circle.createdBy), shared by the admin lists
// (2026-11-22). The server decides (members/actions.ts); these only decide what to show.

import type { Circle } from "@/models/models";

export const isCircleCreator = (
    circle: Pick<Circle, "createdBy"> | null | undefined,
    did: string | undefined,
): boolean => !!circle?.createdBy && !!did && circle.createdBy === did;

// Whether to offer "Remove admin" on a row at all, before the usual permission checks: on the
// creator's row only a superadmin who isn't the creator may take the role (the server refuses
// everyone else, and the creator themselves even as a superadmin).
export const canOfferAdminRemoval = (
    viewer: { did?: string; isAdmin?: boolean } | null | undefined,
    circle: Pick<Circle, "createdBy"> | null | undefined,
    targetDid: string,
): boolean => {
    if (!isCircleCreator(circle, targetDid)) return true;
    return viewer?.isAdmin === true && viewer.did !== targetDid;
};
