// The one server-side rule for personal profiles (Tim, 2026-11-22): the owner, superadmins
// (user.isAdmin) and the owner's accepted connections get the full profile (the page and preview
// also the recipient of the owner's pending connection request, 2026-11-24); everyone else, signed
// in or not, gets the limited version (name, handle, picture; see lib/peerify/personal-profile-
// access.ts). Following doesn't count, and the search and map settings play no part. Circles that
// aren't personal profiles (artists, bands, venues) are always "full".

import type { Circle } from "@/models/models";
import { isPersonalProfile } from "@/lib/peerify/personal-profile-access";
import { Circles, UserRelationships } from "./db";

const isSuperadminDid = async (did: string): Promise<boolean> => {
    const user = await Circles.findOne({ did }, { projection: { isAdmin: 1 } });
    return user?.isAdmin === true;
};

// The page and the preview (and what follows them: the page's tabs, bookmarking). Besides the
// list rule below, the recipient of a pending connection request sees the sender in full while
// they decide (Tim, 2026-11-24). One way only: the viewer's own edge must be "pending_received",
// which only the recipient has; the sender still sees the recipient limited. Declining or
// withdrawing resets the recipient's edge, and a resend inside the decline cooldown writes none,
// so it ends there. Lists (getFullProfileOwnerDids) don't include it.
export const canViewFullPersonalProfile = async (
    circle: Pick<Circle, "circleType" | "did"> | null | undefined,
    viewerDid: string | null | undefined,
): Promise<boolean> => {
    if (!isPersonalProfile(circle)) return true;
    const ownerDid = circle?.did;
    if (!viewerDid || !ownerDid) return false;
    if ((await getFullProfileOwnerDids(viewerDid, [ownerDid])).has(ownerDid)) return true;
    return !!(await UserRelationships.findOne(
        { fromDid: viewerDid, toDid: ownerDid, connectStatus: "pending_received" },
        { projection: { _id: 1 } },
    ));
};

// Batch form for lists (followers rows, post and comment authors): which of these personal
// profile owners may this viewer see in full? Call it with personal profiles' dids only.
export const getFullProfileOwnerDids = async (
    viewerDid: string | null | undefined,
    ownerDids: string[],
): Promise<Set<string>> => {
    const owners = Array.from(new Set(ownerDids.filter(Boolean)));
    if (!viewerDid || owners.length === 0) return new Set();
    if (await isSuperadminDid(viewerDid)) return new Set(owners);

    const allowed = new Set<string>(owners.includes(viewerDid) ? [viewerDid] : []);
    const others = owners.filter((did) => did !== viewerDid);
    if (others.length > 0) {
        const edges = await UserRelationships.find(
            { fromDid: viewerDid, toDid: { $in: others }, connectStatus: "accepted" },
            { projection: { toDid: 1 } },
        ).toArray();
        for (const edge of edges) allowed.add(String((edge as { toDid?: string }).toDid));
    }
    return allowed;
};

// The viewer's accepted connections (the viewer's own "accepted" edges, as getFullProfileOwnerDids
// reads them). They find each other by name and handle even with "Show me in search" off (Tim,
// 2026-11-23): searchDiscoverableCircles / searchPeople and the name-search pickers.
export const getAcceptedConnectionDids = async (viewerDid: string | null | undefined): Promise<string[]> => {
    if (!viewerDid) return [];
    const edges = await UserRelationships.find(
        { fromDid: viewerDid, connectStatus: "accepted" },
        { projection: { toDid: 1 } },
    ).toArray();
    return edges.map((edge) => String((edge as { toDid?: string }).toDid)).filter(Boolean);
};
