import { getCircleByHandle } from "@/lib/data/circle";
import CrewApplicationsModule from "@/components/modules/crew-applications/crew-applications";
import { getAllCrewApplicationsAction } from "@/components/modules/crew-applications/actions";
import { notFound } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";
import CrewOffNote from "@/components/modules/crew-applications/crew-off-note";
import { isCrewOn } from "@/lib/peerify/crew-visibility";

type PageProps = {
    params: Promise<{ handle: string }>;
};

export default async function CrewApplicationsPage({ params }: PageProps) {
    const p = await params;
    const circle = await getCircleByHandle(p.handle);

    if (!circle || !circle._id) {
        notFound();
    }

    const {
        success,
        message,
        pendingApplications = [],
        rejectedApplications = [],
    } = await getAllCrewApplicationsAction(circle._id);

    if (!success) {
        return (
            <Alert variant="destructive" className="m-4">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Error Fetching Applications</AlertTitle>
                <AlertDescription>{message || "An unexpected error occurred."}</AlertDescription>
            </Alert>
        );
    }

    // Crew switched off: the same note as the Crew Dashboard (only reached by managers: the action
    // above already refused everyone else). Pending applications stay stored.
    if (!isCrewOn(circle)) {
        return (
            <div className="mx-auto w-full max-w-3xl p-6">
                <CrewOffNote
                    handle={circle.handle ?? p.handle}
                    aboutToggleOff={circle.crewEnabled === false}
                    pendingCount={pendingApplications.length}
                />
            </div>
        );
    }

    return (
        <CrewApplicationsModule
            circle={circle}
            pendingApplications={pendingApplications}
            rejectedApplications={rejectedApplications}
        />
    );
}
