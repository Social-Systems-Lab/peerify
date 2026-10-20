// \app\feed\page.tsx - mobile Feed: a full-screen scrolling list like /discover, no map or drawer behind it
import { Suspense } from "react";
import ActivityPanel from "@/components/layout/activity-panel";

// The mobile nav's Feed item comes here (desktop keeps /explore?panel=activity). Same ActivityPanel
// the Explore drawer showed, so the same posts, tabs and no posting box (see showCreateNew there).
// A post's location pin sends it to /explore focused on that post (handleMapPinClick in post-list.tsx).
export default function FeedPage() {
    return (
        <div className="w-full pb-24">
            <Suspense>
                <ActivityPanel mode="full" />
            </Suspense>
        </div>
    );
}
