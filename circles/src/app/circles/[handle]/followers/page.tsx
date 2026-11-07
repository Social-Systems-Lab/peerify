import { getCircleByHandle } from "@/lib/data/circle";
import { getPublicCircleForViewer } from "@/lib/data/public-circle-for-viewer";
import { getMembersWithMetrics } from "@/lib/data/member";
import MembersModule from "@/components/modules/members/members"; // Changed to default import
import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { canViewFollowerList } from "@/lib/data/follower-list-access";
import { SortingOptions } from "@/models/models";

type PageProps = {
    params: Promise<{ handle: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function FollowersPage(props: PageProps) {
    const params = await props.params;
    const circle = await getCircleByHandle(params.handle);

    if (!circle || !circle._id) {
        notFound();
    }
    const viewerDid = await getAuthenticatedUserDid();
    // Who may see the list (canViewFollowerList: personal profiles owner only, approval-required
    // circles followers only, the circle's own rule), checked here as well as by the route guard
    // (/api/access), so the list never depends on the middleware alone (leak round 3, M2; D2).
    if (!(await canViewFollowerList(circle, viewerDid))) {
        redirect(`/circles/${params.handle}/access-denied?module=followers&redirectTo=/circles/${params.handle}/followers`);
    }
    // Only what's serialised to client components is shaped; everything above reads the full circle.
    const publicCircle = await getPublicCircleForViewer(circle, viewerDid);
    return <MembersModule circle={publicCircle} />;
}
