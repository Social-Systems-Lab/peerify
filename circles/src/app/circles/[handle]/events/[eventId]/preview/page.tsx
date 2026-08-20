// circles/[handle]/events/[eventId]/preview/page.tsx
import { getCircleByHandle } from "@/lib/data/circle";
import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { features } from "@/lib/data/constants";
import { getEventById, sanitizePeerifyPublicEventDisplay } from "@/lib/data/event";
import EventDetail from "@/components/modules/events/event-detail";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";

type PageProps = {
    params: Promise<{ handle: string; eventId: string }>;
};

export default async function EventPreviewPage(props: PageProps) {
    const params = await props.params;
    const circle = await getCircleByHandle(params.handle);
    if (!circle) {
        notFound();
    }

    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        notFound();
    }

    const event = await getEventById(params.eventId, userDid);
    if (!event) {
        notFound();
    }

    // See the detail page's identical check: the event's host circle can change after creation,
    // so a stale /preview link should follow it to the new host rather than dead-ending.
    if (event.circle?.handle && event.circle.handle !== params.handle) {
        redirect(`/circles/${event.circle.handle}/events/${params.eventId}/preview`);
    }

    const isAuthor = userDid === event.createdBy;
    const canModerate = await isAuthorized(userDid, circle._id as string, features.events.moderate);
    if (!isAuthor && !canModerate) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center">
                <h2 className="mb-2 text-xl font-semibold">Access Denied</h2>
                <p className="text-gray-600">You don&apos;t have permission to preview this event.</p>
                <Button asChild className="mt-4">
                    <Link href={`/circles/${circle.handle}/events`}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Events
                    </Link>
                </Button>
            </div>
        );
    }

    // Run through the exact same sanitizer an anonymous visitor's request would (see
    // getPublicEventByIdForCircle) so this is a faithful preview of the disclosure rules
    // (venue/location privacy, ticketed pricing) rather than a shortcut that bypasses them.
    // stage is forced to "open" — a real anonymous visitor can never reach a draft at all (the
    // public query filters stage: "open"), so this preview is inherently "what a fan would see
    // once you publish," not "what a fan sees of the draft right now."
    const publicEvent = { ...sanitizePeerifyPublicEventDisplay(event), stage: "open" as const };

    return (
        <div className="formatted flex h-full w-full flex-col">
            <div className="mb-4 flex items-center justify-between p-4">
                <Button asChild variant="ghost">
                    <Link href={`/circles/${circle.handle}/events/${params.eventId}`}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Event
                    </Link>
                </Button>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Eye className="h-4 w-4" />
                    Previewing as a public visitor would see it
                </div>
            </div>

            <div className="mx-auto w-full max-w-4xl px-4">
                <div className="rounded-lg bg-white p-6">
                    <EventDetail
                        circle={circle}
                        circleHandle={circle.handle!}
                        event={publicEvent}
                        canEdit={false}
                        canReview={false}
                        canModerate={false}
                        isAuthor={false}
                        previewAsAnonymous
                    />
                </div>
            </div>
        </div>
    );
}
