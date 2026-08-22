// crew-space.tsx
"use client";

import { CrewFeed } from "./crew-feed";
import { getPostsAction, getFeedByHandleAction } from "@/components/modules/feeds/actions";
import { Circle, Feed, PostDisplay } from "@/models/models";
import { useState, useEffect, useTransition, useCallback } from "react";

type CrewSpaceModuleProps = {
    circle: Circle;
};

// Mirrors community.tsx's data-fetching shape exactly, with one addition: getFeedByHandleAction
// returns null both while the fetch is in flight and when the viewer isn't authorized to view
// the Crew feed (getFeedViewFeature("crew") -> features.crew_space.view, gated to
// admins/moderators/crew — no "everyone"). crew/page.tsx always creates the feed eagerly for
// any authenticated visitor, so once the fetch resolves, null unambiguously means "not
// authorized," not "doesn't exist yet." hasFetchedFeed distinguishes that from the initial
// loading state so an unauthorized viewer sees nothing here (no feed, no error message,
// nothing to reveal that a Crew space even exists) rather than a stuck spinner.
export default function CrewSpaceModule({ circle }: CrewSpaceModuleProps) {
    const [feed, setFeed] = useState<Feed | null>(null);
    const [hasFetchedFeed, setHasFetchedFeed] = useState(false);
    const [posts, setPosts] = useState<PostDisplay[]>([]);
    const [isPending, startTransition] = useTransition();
    const [isLoading, setIsLoading] = useState(true);

    const fetchPosts = useCallback(async () => {
        if (!feed) return;

        setIsLoading(true);
        startTransition(async () => {
            try {
                const newPosts = await getPostsAction(feed._id, circle._id, 20, 0, "new", undefined, "crew");
                // getPosts/getPostsWithMetrics re-sorts by a recentness-only rank for "new",
                // which doesn't know about `pinned` — float any pinned post(s) to the front here
                // instead of touching that shared ranking pipeline (Community/Noticeboard also
                // use it). No pagination in this feed (fixed 20-post fetch), so this can't cause
                // a pinned post to duplicate across pages.
                const sorted = [...newPosts].sort((a, b) => (b.pinned === true ? 1 : 0) - (a.pinned === true ? 1 : 0));
                setPosts(sorted);
            } finally {
                setIsLoading(false);
            }
        });
    }, [feed, circle._id]);

    useEffect(() => {
        async function fetchInitialData() {
            const crewFeed = await getFeedByHandleAction(circle?._id, "crew");
            setFeed(crewFeed);
            setHasFetchedFeed(true);
        }
        fetchInitialData();
    }, [circle]);

    useEffect(() => {
        fetchPosts();
    }, [fetchPosts]);

    if (!hasFetchedFeed || !feed) {
        return null;
    }

    return <CrewFeed posts={posts} feed={feed} circle={circle} isLoading={isLoading} onPostCreated={fetchPosts} />;
}
