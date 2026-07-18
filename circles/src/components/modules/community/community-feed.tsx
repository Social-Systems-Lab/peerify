// community-feed.tsx
"use client";

import { useIsCompact } from "@/components/utils/use-is-compact";
import { Circle, Feed, PostDisplay } from "@/models/models";
import PostList from "@/components/modules/feeds/post-list";
import Image from "next/image";

export type CommunityFeedProps = {
    circle: Circle;
    posts: PostDisplay[];
    feed: Feed;
    isLoading?: boolean;
    onPostCreated: () => void;
};

export const CommunityFeed = ({ circle, posts, feed, isLoading = false }: CommunityFeedProps) => {
    const isCompact = useIsCompact();

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
                {/* No <ListFilter> — Community is always reverse-chronological, no sort tabs. */}
                <PostList posts={posts} feed={feed} circle={circle} />
            </div>
        </div>
    );
};
