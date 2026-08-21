// crew-feed.tsx
"use client";

import { useIsCompact } from "@/components/utils/use-is-compact";
import { Circle, Feed, PostDisplay, UserPrivate } from "@/models/models";
import { CrewComposer } from "./crew-composer";
import PostList from "@/components/modules/feeds/post-list";
import { features } from "@/lib/data/constants";
import { userAtom } from "@/lib/data/atoms";
import { useAtom } from "jotai";
import Image from "next/image";

export type CrewFeedProps = {
    circle: Circle;
    posts: PostDisplay[];
    feed: Feed;
    isLoading?: boolean;
    onPostCreated: () => void;
};

// Mirrors community-feed.tsx's canPostIgnoringVerification exactly, swapped to
// crew_space.post. No participation-readiness gating and no guarded-composer fallback here —
// unlike Community (open to any follower, some of whom may not be verified/onboarded yet),
// Crew members are already vetted through the Phase 1 application/approval flow, so there's no
// intermediate "not ready to participate" state to show.
function canPost(user: UserPrivate | undefined, circle: Circle): boolean {
    if (user && user._id === circle._id) return true;
    const allowedGroups = circle.accessRules?.crew_space?.post ?? features.crew_space.post.defaultUserGroups ?? [];
    if (allowedGroups.includes("everyone")) return true;
    const membership = user?.memberships?.find((m) => m.circleId === circle._id);
    if (!membership) return false;
    return allowedGroups.some((group) => membership.userGroups.includes(group));
}

export const CrewFeed = ({ circle, posts, feed, isLoading = false, onPostCreated }: CrewFeedProps) => {
    const isCompact = useIsCompact();
    const [user] = useAtom(userAtom);

    const hasPostPermission = canPost(user as UserPrivate | undefined, circle);

    const containerStyle = {
        flexGrow: isCompact ? "1" : "3",
        maxWidth: isCompact ? "none" : "700px",
    };

    if (isLoading) {
        return (
            <div className="flex w-full flex-1 items-center justify-center" style={containerStyle}>
                <div className="flex w-full max-w-[700px] flex-col items-center text-center">
                    <Image src="/peerify/logo-mark.png" alt="Peerify logo" width={72} height={72} priority />
                    <p className="mt-4 text-sm font-medium text-gray-600">Crew space loading…</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex w-full flex-1 items-start justify-center" style={containerStyle}>
            <div className="flex w-full flex-col">
                {hasPostPermission && (
                    <div className="flex w-full justify-center">
                        <div className="w-full max-w-[700px]">
                            <CrewComposer circle={circle} feed={feed} onPostCreated={onPostCreated} />
                        </div>
                    </div>
                )}
                {/* No <ListFilter> — like Community, the Crew space is always reverse-chronological. */}
                <PostList posts={posts} feed={feed} circle={circle} />
            </div>
        </div>
    );
};
