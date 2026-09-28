import { getCircleByHandle } from "@/lib/data/circle";
import { getPublicCircleForViewer } from "@/lib/data/public-circle-for-viewer";
import CommunityModule from "@/components/modules/community/community";
import { notFound } from "next/navigation";
import { createCommunityFeed } from "@/lib/data/feed";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";

type PageProps = {
    params: Promise<{ handle: string }>;
};

export default async function CommunityPage(props: PageProps) {
    const params = await props.params;
    const circle = await getCircleByHandle(params.handle);

    if (!circle) {
        notFound();
    }

    // ensure it has a community feed
    let userDid = await getAuthenticatedUserDid();
    if (userDid) {
        await createCommunityFeed(circle._id);
    }

    // Only what's serialised to client components is shaped; everything above reads the full circle.
    const publicCircle = await getPublicCircleForViewer(circle, userDid);
    const plainCircle = JSON.parse(JSON.stringify(publicCircle));
    return <CommunityModule circle={plainCircle} />;
}
