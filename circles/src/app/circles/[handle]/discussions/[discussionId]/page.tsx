import { DiscussionItem } from "@/components/modules/discussions/discussion-list";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getPublicCircleForViewer } from "@/lib/data/public-circle-for-viewer";
import { notFound } from "next/navigation";
import { getCircleByHandle } from "@/lib/data/circle";
import { getFeed, getFullPost } from "@/lib/data/feed";

interface DiscussionDetailPageProps {
    params: Promise<{ handle: string; discussionId: string }>;
}

export default async function DiscussionDetailPage(props: DiscussionDetailPageProps) {
    const { handle, discussionId } = await props.params;
    const post = await getFullPost(discussionId);
    const circle = await getCircleByHandle(handle);

    if (!post || !circle) {
        notFound();
    }

    const feed = await getFeed(post.feedId);

    if (!feed) {
        notFound();
    }

    const viewerDid = await getAuthenticatedUserDid();
    // Only what's serialised to client components is shaped; everything above reads the full circle.
    const publicCircle = await getPublicCircleForViewer(circle, viewerDid);
    return (
        <div className="mx-auto max-w-3xl p-6">
            <DiscussionItem post={post} circle={publicCircle} feed={feed} />
        </div>
    );
}
