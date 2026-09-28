import GoalsModule from "@/components/modules/goals/goals";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getPublicCircleForViewer } from "@/lib/data/public-circle-for-viewer";
import { getCircleByHandle } from "@/lib/data/circle";
import { notFound } from "next/navigation";

type PageProps = {
    params: Promise<{ handle: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function GoalsPage(props: PageProps) {
    // Renamed function
    const params = await props.params;
    const circle = await getCircleByHandle(params.handle);

    if (!circle) {
        notFound(); // Show 404 if circle doesn't exist
    }

    // Render the GoalsModule, passing the fetched circle data
    // GoalsModule will handle fetching its own data (goals) and permissions
    const viewerDid = await getAuthenticatedUserDid();
    // Only what's serialised to client components is shaped; everything above reads the full circle.
    const publicCircle = await getPublicCircleForViewer(circle, viewerDid);
    return <GoalsModule circle={publicCircle} />; // Use renamed component
}
