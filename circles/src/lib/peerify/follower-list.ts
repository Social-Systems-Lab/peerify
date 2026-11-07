import type { Circle } from "@/models/models";

// Tim's decision D2 (2026-11-07): a personal profile's follower list is for its owner only. The
// Followers tab and the follower-count link are hidden for everyone else. Client-safe (no db).
export const isFollowerListOwnerOnly = (circle: Pick<Circle, "circleType"> | null | undefined): boolean =>
    circle?.circleType === "user";

export const canSeeFollowersLink = (
    circle: Pick<Circle, "circleType" | "did"> | null | undefined,
    viewerDid: string | undefined,
): boolean => !isFollowerListOwnerOnly(circle) || (!!viewerDid && viewerDid === circle?.did);

// The group labels anyone may see on a follower list; Crew and custom groups are for the circle's
// admins and moderators (D2).
export const PUBLIC_MEMBER_GROUP_LABELS = ["admins", "moderators", "members"];
