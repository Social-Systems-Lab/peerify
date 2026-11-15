import { getCircleByHandle } from "@/lib/data/circle";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getPublicCircleForViewer } from "@/lib/data/public-circle-for-viewer";
import CirclesModule from "@/components/modules/circles/circles"; // Assuming default export
import { notFound } from "next/navigation";
import { canViewProfileCirclesList } from "@/lib/data/profile-circles-access";

type PageProps = {
    params: Promise<{ handle: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function CirclesPage(props: PageProps) {
    const params = await props.params;
    const circle = await getCircleByHandle(params.handle);

    if (!circle) {
        notFound();
    }

    // Pass circle and original props down to CirclesModule
    // CirclesModule likely fetches its own sub-circle data using these props
    const viewerDid = await getAuthenticatedUserDid();
    // A personal profile's Circles list is for its owner and platform admins only (checked here as
    // well as by the route guard, so the list never depends on the middleware alone).
    if (!(await canViewProfileCirclesList(circle, viewerDid))) {
        notFound();
    }
    // Only what's serialised to client components is shaped; everything above reads the full circle.
    const publicCircle = await getPublicCircleForViewer(circle, viewerDid);
    return <CirclesModule {...props} circle={publicCircle} />;
}
