import { getCircleByHandle } from "@/lib/data/circle";
import { getEventHostChangeRequestsForCircleAction } from "@/app/circles/[handle]/events/actions";
import EventHostRequests from "@/components/modules/events/event-host-requests";
import { notFound } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";

type PageProps = {
    params: Promise<{ handle: string }>;
};

export default async function EventHostRequestsPage({ params }: PageProps) {
    const p = await params;
    const circle = await getCircleByHandle(p.handle);

    if (!circle || !circle._id) {
        notFound();
    }

    const { success, message, requests = [] } = await getEventHostChangeRequestsForCircleAction(p.handle);

    if (!success) {
        return (
            <Alert variant="destructive" className="m-4">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Error Fetching Requests</AlertTitle>
                <AlertDescription>{message || "An unexpected error occurred."}</AlertDescription>
            </Alert>
        );
    }

    return <EventHostRequests circle={circle} requests={requests} />;
}
