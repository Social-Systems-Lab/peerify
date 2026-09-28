import { getCircleByHandle } from "@/lib/data/circle";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getPublicCircleForViewer } from "@/lib/data/public-circle-for-viewer";
import ProjectsModule from "@/components/modules/projects/projects"; // Assuming default export
import { notFound } from "next/navigation";

type PageProps = {
    params: Promise<{ handle: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function ProjectsPage(props: PageProps) {
    const params = await props.params;
    const circle = await getCircleByHandle(params.handle);

    if (!circle) {
        notFound();
    }

    // Pass circle and original props down to ProjectsModule
    // ProjectsModule likely fetches its own project data using these props
    const viewerDid = await getAuthenticatedUserDid();
    // Only what's serialised to client components is shaped; everything above reads the full circle.
    const publicCircle = await getPublicCircleForViewer(circle, viewerDid);
    return <ProjectsModule {...props} circle={publicCircle} />;
}
