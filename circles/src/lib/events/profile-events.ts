// Client-safe. A personal profile's Events tab (Tim, 2026-11-15). It listed, for the owner, every
// event they created anywhere (a venue's events too) and every event they RSVP'd "going" to, and for
// everyone else the events hosted on the profile. Now it lists only open, public events the person
// created on their own profile: never events they attend, are interested in or help at, and never
// events they made under another circle (a venue they run). The owner also sees their own events
// on the profile that aren't open or public yet (drafts, in review, members-only), as before.
// Applied in getEventsAction (app/circles/[handle]/events/actions.ts).

import type { EventDisplay } from "@/models/models";

type ProfileEvent = Pick<EventDisplay, "circleId" | "createdBy" | "stage" | "visibility" | "userGroups">;

const isOpenAudience = (userGroups: string[] | null | undefined) =>
    !userGroups || userGroups.length === 0 || userGroups.includes("everyone");

export const isOpenPublicEvent = (event: Pick<ProfileEvent, "stage" | "visibility" | "userGroups">): boolean =>
    event.stage === "open" && event.visibility !== "private" && isOpenAudience(event.userGroups);

export const isProfileTabEvent = (
    event: ProfileEvent,
    profile: { _id?: unknown; did?: string },
    viewerIsOwner: boolean,
): boolean => {
    if (!profile.did || event.createdBy !== profile.did) return false;
    if (profile._id === undefined || String(event.circleId) !== String(profile._id)) return false;
    return viewerIsOwner || isOpenPublicEvent(event);
};
