import { DiscussionItem } from "@/components/modules/discussions/discussion-list";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getPublicCircleForViewer } from "@/lib/data/public-circle-for-viewer";
import { notFound } from "next/navigation";
import { getCircleByHandle } from "@/lib/data/circle";
import { canUserViewPost, getFeed, getFullPost, getPost } from "@/lib/data/feed";

interface DiscussionDetailPageProps {
    params: Promise<{ handle: string; discussionId: string }>;
}

export default async function DiscussionDetailPage(props: DiscussionDetailPageProps) {
    const { handle, discussionId } = await props.params;
    const circle = await getCircleByHandle(handle);
    if (!circle) {
        notFound();
    }

    // Only a discussion in this circle's own feed, and only for viewers canUserViewPost lets see it.
    // Middleware only checks that the circle in the URL has the discussions module, so without these
    // checks any post id (any type, any circle, any audience) rendered here for anyone.
    const post = await getPost(discussionId);
    if (!post || post.postType !== "discussion") {
        notFound();
    }

    const feed = await getFeed(post.feedId);
    if (!feed || feed.circleId !== circle._id) {
        notFound();
    }

    const viewerDid = await getAuthenticatedUserDid();
    if (!(await canUserViewPost(post, viewerDid))) {
        notFound();
    }

    const fullPost = await getFullPost(discussionId, viewerDid);
    if (!fullPost) {
        notFound();
    }

    // Only what's serialised to client components is shaped; everything above reads the full circle.
    const publicCircle = await getPublicCircleForViewer(circle, viewerDid);
    return (
        <div className="mx-auto max-w-3xl p-6">
            <DiscussionItem post={fullPost} circle={publicCircle} feed={feed} />
        </div>
    );
}
