// circles/[handle]/events/[eventId]/page.tsx
import { getCircleByHandle } from "@/lib/data/circle";
import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { features } from "@/lib/data/constants";
import { getEventAction } from "@/app/circles/[handle]/events/actions";
import EventDetail from "@/components/modules/events/event-detail";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { isPeerifyManagedIdentity } from "@/lib/peerify/artist-profile";
import { isCircleAdminOfAny } from "@/lib/data/member";

type PageProps = {
    params: Promise<{ handle: string; eventId: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function EventDetailPage(props: PageProps) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    const sourceParam = Array.isArray(searchParams?.source) ? searchParams.source[0] : searchParams?.source;
    const isNoticeboardSource = sourceParam === "noticeboard";
    const circle = await getCircleByHandle(params.handle);
    if (!circle) {
        notFound();
    }

    const userDid = await getAuthenticatedUserDid();
    const isPublicPeerifyManagedEvents = !userDid && isPeerifyManagedIdentity(circle);
    if (!isPublicPeerifyManagedEvents) {
        if (!userDid) {
            notFound();
        }

        const canView = await isAuthorized(userDid, circle._id as string, features.events.view);
        if (!canView) {
            notFound();
        }
    }

    const event = await getEventAction(circle.handle!, params.eventId);
    if (!event) {
        notFound();
    }

    // The event's host circle can change after creation (see changeEventHostAction). event.circle
    // is populated fresh from a live $lookup on every fetch, so if it no longer matches the URL's
    // handle, this is a stale link — send the visitor to the canonical URL instead of a dead end.
    if (event.circle?.handle && event.circle.handle !== params.handle) {
        redirect(
            `/circles/${event.circle.handle}/events/${params.eventId}${isNoticeboardSource ? "?source=noticeboard" : ""}`,
        );
    }

    // Permissions
    const canModerate = userDid ? await isAuthorized(userDid, circle._id as string, features.events.moderate) : false;
    const canReview = userDid ? await isAuthorized(userDid, circle._id as string, features.events.review) : false;
    const isAuthor = !!userDid && userDid === event.createdBy;
    const isArtistAdmin = userDid ? await isCircleAdminOfAny(userDid, event.artistAdminCircleIds) : false;
    const canEdit = canModerate || isAuthor || isArtistAdmin;
    // Narrower than canEdit: lets an admin of a listed (non-delegated) band remove that band from
    // this event, without granting them any other edit rights.
    const canRemoveSelfAsArtist = userDid ? await isCircleAdminOfAny(userDid, event.additionalArtistCircleIds) : false;

    return (
        <div className="formatted flex w-full flex-col">
            <div className="mb-4 flex items-center p-4">
                <Button asChild variant="ghost" className="mr-2">
                    <Link href={`/circles/${circle.handle}/${isNoticeboardSource ? "feed" : "events"}`}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        {isNoticeboardSource ? "Back to Noticeboard" : "Back to Events"}
                    </Link>
                </Button>
            </div>

            <div className="mx-auto w-full max-w-4xl px-4">
                <div className="rounded-lg bg-white p-6">
                    <EventDetail
                        circle={circle}
                        circleHandle={circle.handle!}
                        event={event}
                        canEdit={!!canEdit}
                        canReview={!!canReview}
                        canModerate={!!canModerate}
                        isAuthor={isAuthor}
                        canRemoveSelfAsArtist={canRemoveSelfAsArtist}
                    />
                </div>
            </div>
        </div>
    );
}
