// Client-safe (no db). A personal profile's Circles tab (module "communities") lists the circles
// made under that profile, such as a venue the person runs, and for the owner also the circles they
// created or joined. It was public, with no setting for it (personal profiles hide Pages and Access
// rules). Now it's for the profile's owner and platform admins only, the tab as well as the page and
// its data (Tim, 2026-11-15). Bands, artists, venues and other circles are unchanged. Later this
// becomes the three-level visibility (default: only me; options Contacts or Public).
// The server-side check is canViewProfileCirclesList (lib/data/profile-circles-access.ts).

import type { Circle } from "@/models/models";

export const PROFILE_CIRCLES_MODULE = "communities";

export const isProfileCirclesListOwnerOnly = (circle: Pick<Circle, "circleType"> | null | undefined): boolean =>
    circle?.circleType === "user";

// For the tab bar: the signed-in user as the client knows them.
export const canSeeProfileCirclesTab = (
    circle: Pick<Circle, "circleType" | "did"> | null | undefined,
    viewer: { did?: string; isAdmin?: boolean } | null | undefined,
): boolean => {
    if (!isProfileCirclesListOwnerOnly(circle)) return true;
    if (!viewer?.did) return false;
    return viewer.did === circle?.did || viewer.isAdmin === true;
};
