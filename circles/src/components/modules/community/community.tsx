// community.tsx

"use client";

import { CommunityFeed } from "./community-feed";
import { getPostsAction, getFeedByHandleAction } from "@/components/modules/feeds/actions";
import { Circle, PostDisplay } from "@/models/models";
import { useState, useEffect, useTransition, useCallback } from "react";

type PageProps = {
    circle: Circle;
};

// Deliberately no sorting state, no <ListFilter> — Community is always a
// single reverse-chronological list (sortingOptions: "new"), per the agreed
// MVP scope (no Top/Near/Activity/Resonates tabs). Otherwise mirrors
// feeds.tsx's FeedsModule shape exactly.
export default function CommunityModule(props: PageProps) {
    const { circle } = props;
    const [feed, setFeed] = useState<any>(null);
    const [posts, setPosts] = useState<PostDisplay[]>([]);
    const [isPending, startTransition] = useTransition();
    const [isLoading, setIsLoading] = useState(true);

    const fetchPosts = useCallback(async () => {
        if (!feed) return;

        setIsLoading(true);
        startTransition(async () => {
            try {
                const newPosts = await getPostsAction(feed._id, circle._id, 20, 0, "new");
                setPosts(newPosts);
            } finally {
                setIsLoading(false);
            }
        });
    }, [feed, circle._id]);

    useEffect(() => {
        async function fetchInitialData() {
            const communityFeed = await getFeedByHandleAction(circle?._id, "community");
            if (communityFeed) {
                setFeed(communityFeed);
            }
        }
        fetchInitialData();
    }, [circle]);

    useEffect(() => {
        fetchPosts();
    }, [fetchPosts]);

    if (!feed) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <div className="text-sm text-gray-500">Community loading…</div>
            </div>
        );
    }

    return (
        <div className="flex flex-1 justify-center overflow-hidden">
            <div className="mb-4 mt-2 flex w-full max-w-[1280px] flex-col items-center md:ml-4 md:mr-4">
                <CommunityFeed posts={posts} feed={feed} circle={circle} isLoading={isLoading} onPostCreated={fetchPosts} />
            </div>
        </div>
    );
}
