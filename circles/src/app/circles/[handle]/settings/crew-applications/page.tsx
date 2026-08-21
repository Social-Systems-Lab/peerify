import { getCircleByHandle } from "@/lib/data/circle";
import CrewApplicationsModule from "@/components/modules/crew-applications/crew-applications";
import { getAllCrewApplicationsAction } from "@/components/modules/crew-applications/actions";
import { notFound } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";

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

    return (
        <CrewApplicationsModule
            circle={circle}
            pendingApplications={pendingApplications}
            rejectedApplications={rejectedApplications}
        />
    );
}
