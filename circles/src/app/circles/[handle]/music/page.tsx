import { redirect } from "next/navigation";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getPublicCircleForViewer } from "@/lib/data/public-circle-for-viewer";
import { getCircleByHandle } from "@/lib/data/circle";
import MusicModule from "@/components/modules/music/Music";

type MusicPageProps = {
    params: Promise<{ handle: string }>;
};

export default async function MusicPage(props: MusicPageProps) {
    if (process.env.IS_BUILD === "true") {
        return null;
    }

    const { handle } = await props.params;
    const circle = await getCircleByHandle(handle);
    if (!circle) {
        redirect("/not-found");
    }

    const viewerDid = await getAuthenticatedUserDid();
    // Only what's serialised to client components is shaped; everything above reads the full circle.
    const publicCircle = await getPublicCircleForViewer(circle, viewerDid);
    return <MusicModule circle={publicCircle} />;
}
