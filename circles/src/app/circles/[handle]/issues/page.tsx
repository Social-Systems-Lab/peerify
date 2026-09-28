import IssuesModule from "@/components/modules/issues/Issues";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getPublicCircleForViewer } from "@/lib/data/public-circle-for-viewer";
import { getCircleByHandle } from "@/lib/data/circle";
import { notFound } from "next/navigation";

type PageProps = {
    params: Promise<{ handle: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function IssuesPage(props: PageProps) {
    const params = await props.params;
    const circle = await getCircleByHandle(params.handle);

    if (!circle) {
        notFound(); // Show 404 if circle doesn't exist
    }

    // Render the IssuesModule, passing the fetched circle data
    // IssuesModule will handle fetching its own data (issues) and permissions
    const viewerDid = await getAuthenticatedUserDid();
    // Only what's serialised to client components is shaped; everything above reads the full circle.
    const publicCircle = await getPublicCircleForViewer(circle, viewerDid);
    return <IssuesModule circle={publicCircle} />;
}
