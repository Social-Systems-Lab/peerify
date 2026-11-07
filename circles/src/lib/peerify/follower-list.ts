import type { Circle } from "@/models/models";

// Client-safe (no db). Who sees a circle's follower list, tab and follower links (Tim's decision,
// 2026-11-07, privacy by default, replacing D2's "open circles stay public"): the circle's admins
// and moderators only; a personal profile's owner only. Everyone else, logged out too, sees the
// follower count as plain text. Platform admins keep the list of non-personal circles, as before.
// The server-side check is canViewFollowerList (lib/data/follower-list-access.ts).

export const FOLLOWER_LIST_GROUPS = ["admins", "moderators"];

export const isFollowerListOwnerOnly = (circle: Pick<Circle, "circleType"> | null | undefined): boolean =>
    circle?.circleType === "user";

type FollowerListViewer =
    | {
          did?: string;
          isAdmin?: boolean;
          memberships?: { circleId: string; userGroups?: string[] }[];
      }
    | null
    | undefined;

export const canSeeFollowersLink = (
    circle: Pick<Circle, "_id" | "circleType" | "did"> | null | undefined,
    viewer: FollowerListViewer,
): boolean => {
    if (!circle || !viewer?.did) return false;
    if (isFollowerListOwnerOnly(circle)) return viewer.did === circle.did;
    if (viewer.isAdmin === true) return true;
    const membership = viewer.memberships?.find((m) => m.circleId === circle._id);
    return membership?.userGroups?.some((group) => FOLLOWER_LIST_GROUPS.includes(group)) ?? false;
};

// The group labels anyone may see on a follower list; Crew and custom groups are for the circle's
// admins and moderators (D2).
export const PUBLIC_MEMBER_GROUP_LABELS = ["admins", "moderators", "members"];
