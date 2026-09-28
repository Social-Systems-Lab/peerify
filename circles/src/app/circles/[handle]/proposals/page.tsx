import { getCircleByHandle } from "@/lib/data/circle";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getPublicCircleForViewer } from "@/lib/data/public-circle-for-viewer";
import ProposalsTabs from "@/components/modules/proposals/proposals-tabs";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { getProposalsByCircleIdAction } from "@/app/circles/[handle]/proposals/actions"; // Import the action
import { ProposalDisplay } from "@/models/models";

type PageProps = {
    params: Promise<{ handle: string }>; // Correctly typed as a Promise
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>; // Correctly typed as a Promise
};

export default async function ProposalsPage(props: PageProps) {
    const params = await props.params; // Await the promise to get actual params
    const circle = await getCircleByHandle(params.handle);

    if (!circle) {
        notFound();
    }

    // Fetch proposals server-side
    let initialProposals: ProposalDisplay[] = [];
    const proposalsResult = await getProposalsByCircleIdAction(params.handle);
    if (proposalsResult.success && proposalsResult.proposals) {
        initialProposals = proposalsResult.proposals;
    } else {
        // Handle error or empty state, perhaps log it
        console.error("Failed to fetch proposals for page:", proposalsResult.message);
    }

    const viewerDid = await getAuthenticatedUserDid();
    // Only what's serialised to client components is shaped; everything above reads the full circle.
    const publicCircle = await getPublicCircleForViewer(circle, viewerDid);
    return (
        <Suspense
            fallback={
                <div className="flex h-screen w-full items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin" />
                </div>
            }
        >
            <ProposalsTabs circle={publicCircle} initialProposals={initialProposals} />
        </Suspense>
    );
}
