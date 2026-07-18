import { getCircleByHandle } from "@/lib/data/circle";
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

    const plainCircle = JSON.parse(JSON.stringify(circle));

    return <CommunityModule circle={plainCircle} />;
}
