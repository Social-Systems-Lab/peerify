import { getCircleByHandle } from "@/lib/data/circle";
import { getPublicCircleForViewer } from "@/lib/data/public-circle-for-viewer";
import CrewModule from "@/components/modules/crew/crew";
import { notFound } from "next/navigation";
import { createCrewFeed } from "@/lib/data/feed";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";

type PageProps = {
    params: Promise<{ handle: string }>;
};

export default async function CrewPage({ params }: PageProps) {
    const p = await params;
    const circle = await getCircleByHandle(p.handle);

    if (!circle || !circle._id) {
        notFound();
    }

    // Ensure the circle has a Crew feed, mirroring community/page.tsx's eager
    // create-on-visit — guarantees the feed always exists by the time
    // crew-space.tsx fetches it, so a null result there unambiguously means
    // "not authorized," not "doesn't exist yet."
    const userDid = await getAuthenticatedUserDid();
    if (userDid) {
        await createCrewFeed(circle._id);
    }

    // Only what's serialised to client components is shaped; everything above reads the full circle.
    const publicCircle = await getPublicCircleForViewer(circle, userDid);
    return <CrewModule circle={publicCircle} />;
}
