"use server";

import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getMember, setCrewVisibility, getCrewOfferings, CrewOfferer } from "@/lib/data/member";
import { getUserPendingCrewApplication } from "@/lib/data/crew-applications";
import { tourTeamOfferingTypeLabels } from "@/lib/data/tour-team-offerings";

export type CrewOfferAggregateEntry = {
    type: string;
    label: string;
    count: number;
};

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

// Deliberately a fresh DB read on every call, NOT derived from user.memberships (the client-side
// userAtom populated once per tab/session by Authenticator's mount-time checkAuth() call). An
// approval happens in a different browser/session (the admin's), so a fan's already-open tab has
// no way to learn about it without either a full page reload or this kind of live re-check —
// reproduced empirically: userAtom stays stale across client-side navigation until the page is
// actually reloaded. follow-button.tsx solves the analogous same-tab case with an optimistic
// local userAtom patch, but that doesn't help here since the mutating action happens in someone
// else's session entirely.
export const getCrewMembershipStatusAction = async (
    circleId: string,
): Promise<{ status: "approved" | "pending" | "none" }> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid || !circleId) {
        return { status: "none" };
    }

    const member = await getMember(userDid, circleId);
    if (member?.userGroups?.includes("crew")) {
        return { status: "approved" };
    }

    const pending = await getUserPendingCrewApplication(userDid, circleId);
    return { status: pending ? "pending" : "none" };
};

// Binary crew-visibility rule for Offers, same relationship shape as
// getCrewProfileAccessAction: the artist's own admins/moderators always see every crew member's
// offerings for this circle, regardless of each member's own crewVisible toggle; a plain
// approved crew member sees every OTHER approved crew member's offerings EXCEPT those who've
// set crewVisible: false (same peer-suppression rule the member list already applies via
// isSuppressedCrewMember — no further per-offer restriction beyond that, Phase 2 is binary
// only, no field-level granularity). Anyone else (not crew, not admin/mod of this specific
// circle — including a crew member of a *different* artist) gets nothing. eligible is
// returned separately so the caller can distinguish "no offers to show" from "you can't see
// this at all," without leaking which one via content alone.
// Redesign (2026-08-22): a plain crew member no longer gets names/avatars in the response at
// all for this circle's Offers — not just a rendering choice, the aggregate is computed HERE,
// server-side, so a peer's browser never receives who-offers-what. Only the circle's own
// admins/moderators get the full per-person breakdown. isAdminOrMod is returned so the widget
// knows which shape to expect without re-deriving it from (potentially stale) client state.
export const getCrewOffersAction = async (
    circleId: string,
): Promise<{
    eligible: boolean;
    isAdminOrMod: boolean;
    offerers?: CrewOfferer[];
    aggregate?: CrewOfferAggregateEntry[];
}> => {
    const viewerDid = await getAuthenticatedUserDid();
    if (!viewerDid || !circleId) {
        return { eligible: false, isAdminOrMod: false };
    }

    const viewerMember = await getMember(viewerDid, circleId);
    const isAdminOrMod = viewerMember?.userGroups?.some((group) => group === "admins" || group === "moderators") ?? false;
    const isCrew = viewerMember?.userGroups?.includes("crew") ?? false;
    if (!isAdminOrMod && !isCrew) {
        return { eligible: false, isAdminOrMod: false };
    }

    const offerers = await getCrewOfferings(circleId, isAdminOrMod ? undefined : viewerDid, isAdminOrMod);

    if (isAdminOrMod) {
        return { eligible: true, isAdminOrMod: true, offerers };
    }

    const countsByType = new Map<string, number>();
    for (const offerer of offerers) {
        for (const offering of offerer.tourTeamOfferings) {
            const key = offering.type === "custom" ? "custom" : offering.type;
            countsByType.set(key, (countsByType.get(key) ?? 0) + 1);
        }
    }
    const aggregate: CrewOfferAggregateEntry[] = Array.from(countsByType.entries()).map(([type, count]) => ({
        type,
        label: type === "custom" ? "Other" : tourTeamOfferingTypeLabels[type as keyof typeof tourTeamOfferingTypeLabels] ?? type,
        count,
    }));

    return { eligible: true, isAdminOrMod: false, aggregate };
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
