// Client-safe. Likes need what commenting needs, a verified profile included (2026-11-22,
// likeContentAction). A like button asks this before its optimistic +1: when the like would be
// refused only because the profile isn't verified yet, it shows UNVERIFIED_PROFILE_EXPLAINER (the
// comment box's explanation) instead of liking and then silently undoing. The server sends the same
// text when it refuses for that reason, which the buttons also check (isUnverifiedRefusal).

import { hasFeatureAccessIgnoringVerification, isAuthorized } from "@/lib/auth/client-auth";
import { UNVERIFIED_PROFILE_EXPLAINER } from "@/lib/auth/verification";
import { getPostCommentFeature } from "@/lib/data/constants";
import type { Circle, Post, UserPrivate } from "@/models/models";

export const isLikeBlockedUntilVerified = (
    user: UserPrivate | undefined | null,
    circle: Circle | undefined | null,
    postType?: Post["postType"],
): boolean => {
    if (!user || !circle) return false;
    const feature = getPostCommentFeature(postType);
    return hasFeatureAccessIgnoringVerification(user, circle, feature) && !isAuthorized(user, circle, feature);
};

export const isUnverifiedRefusal = (result: { success: boolean; message?: string }): boolean =>
    !result.success && result.message === UNVERIFIED_PROFILE_EXPLAINER;
