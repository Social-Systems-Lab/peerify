// community-feed.tsx
"use client";

import { useIsCompact } from "@/components/utils/use-is-compact";
import { Circle, Feed, PostDisplay, UserPrivate } from "@/models/models";
import { CommunityComposer } from "./community-composer";
import { GuardedCommunityComposer } from "./community-composer-guarded";
import PostList from "@/components/modules/feeds/post-list";
import { features } from "@/lib/data/constants";
import { userAtom } from "@/lib/data/atoms";
import { useAtom } from "jotai";
import Image from "next/image";
import { getParticipationState } from "@/lib/auth/participation-readiness";

export type CommunityFeedProps = {
    circle: Circle;
    posts: PostDisplay[];
    feed: Feed;
    isLoading?: boolean;
    onPostCreated: () => void;
};

// canPostIgnoringVerification mirrors @/lib/auth/client-auth's isAuthorized()
// body for group-membership, deliberately WITHOUT its needsToBeVerified
// short-circuit — this is "hasPostPermission" (circle-level community.post
// access), kept separate from participation-readiness (see
// getParticipationState below) so a follower who has permission but isn't
// participation-ready sees a guarded composer instead of no composer at all.
// The real enforcement boundary is still the server action either way.
function canPostIgnoringVerification(user: UserPrivate | undefined, circle: Circle): boolean {
    if (user && user._id === circle._id) return true;
    const allowedGroups = circle.accessRules?.community?.post ?? features.community.post.defaultUserGroups ?? [];
    if (allowedGroups.includes("everyone")) return true;
    const membership = user?.memberships?.find((m) => m.circleId === circle._id);
    if (!membership) return false;
    return allowedGroups.some((group) => membership.userGroups.includes(group));
}

export const CommunityFeed = ({ circle, posts, feed, isLoading = false, onPostCreated }: CommunityFeedProps) => {
    const isCompact = useIsCompact();
    const [user] = useAtom(userAtom);

    const hasPostPermission = canPostIgnoringVerification(user as UserPrivate | undefined, circle);
    const participation = getParticipationState(user as UserPrivate | undefined);

    const containerStyle = {
        flexGrow: isCompact ? "1" : "3",
        maxWidth: isCompact ? "none" : "700px",
    };

    if (isLoading) {
        return (
            <div className="flex h-full min-h-[320px] w-full flex-1 items-center justify-center" style={containerStyle}>
                <div className="flex w-full max-w-[700px] flex-col items-center text-center">
                    <Image src="/peerify/logo-mark.png" alt="Peerify logo" width={72} height={72} priority />
                    <p className="mt-4 text-sm font-medium text-gray-600">Community loading…</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-screen w-full flex-1 items-start justify-center" style={containerStyle}>
            <div className="flex w-full flex-col">
                {hasPostPermission && (
                    <div className="flex w-full justify-center">
                        <div className="w-full max-w-[700px]">
                            {participation.canParticipate ? (
                                <CommunityComposer circle={circle} feed={feed} onPostCreated={onPostCreated} />
                            ) : (
                                <GuardedCommunityComposer circle={circle} participation={participation} />
                            )}
                        </div>
                    </div>
                )}
                {/* No <ListFilter> — Community is always reverse-chronological, no sort tabs. */}
                <PostList posts={posts} feed={feed} circle={circle} />
            </div>
        </div>
    );
};
