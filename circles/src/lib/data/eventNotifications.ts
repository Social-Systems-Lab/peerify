import { Circle, Event as EventModel, EventDisplay, EventStage, UserPrivate } from "@/models/models";
import { sendNotifications } from "./notifications";
import { getUserPrivate } from "./user";
import { getCircleById } from "./circle";
import { getMembers } from "./member";
import { features } from "./constants";
import { getAuthorizedMembers } from "../auth/auth";
import { sanitizeObjectForJSON } from "../utils/sanitize";

/**
 * Resolve the Circle for an event
 */
async function getEventCircle(event: Pick<EventModel, "circleId">): Promise<Circle | null> {
    if (!event?.circleId) return null;
    const circle = await getCircleById(event.circleId);
    return circle;
}

/**
 * Notify reviewers when an event is submitted for review (draft -> review)
 */
export async function notifyEventSubmittedForReview(
    event: Pick<EventModel, "_id" | "title" | "circleId">,
    submitter: Circle,
) {
    try {
        const circle = await getEventCircle(event);
        if (!circle) return;

        // Find DIDs of users with review permission (excluding the submitter)
        const reviewerDids = (await getAuthorizedMembers(circle, features.events?.review))
            .map((u) => u.did)
            .filter((did): did is string => !!did && did !== submitter.did);

        if (reviewerDids.length === 0) return;

        const reviewerPrivates: UserPrivate[] = (
            await Promise.all(reviewerDids.map((did) => getUserPrivate(did)))
        ).filter((up): up is UserPrivate => up !== null);

        if (reviewerPrivates.length === 0) return;

        await sendNotifications(
            "event_submitted_for_review",
            reviewerPrivates,
            sanitizeObjectForJSON({
                circle,
                user: submitter,
                eventId: (event as any)._id?.toString?.() || String((event as any)._id),
                eventTitle: event.title,
            }),
        );
    } catch (err) {
        console.error("Error in notifyEventSubmittedForReview:", err);
    }
}

/**
 * Notify the event author when the event is approved/opened (review -> open, or draft -> open)
 */
export async function notifyEventApproved(
    event: Pick<EventModel, "_id" | "title" | "circleId" | "createdBy">,
    approver: Circle,
) {
    try {
        const circle = await getEventCircle(event);
        if (!circle) return;

        // Don't notify if approver is the author
        if (event.createdBy === approver.did) return;

        const author = await getUserPrivate(event.createdBy);
        if (!author) return;

        await sendNotifications(
            "event_approved",
            [author],
            sanitizeObjectForJSON({
                circle,
                user: approver,
                eventId: (event as any)._id?.toString?.() || String((event as any)._id),
                eventTitle: event.title,
            }),
        );
    } catch (err) {
        console.error("Error in notifyEventApproved:", err);
    }
}

/**
 * Notify the event author when the event's status changes (generic)
 */
export async function notifyEventStatusChanged(
    event: Pick<EventModel, "_id" | "title" | "circleId" | "createdBy" | "stage">,
    changer: Circle,
    oldStage: EventStage,
) {
    try {
        const circle = await getEventCircle(event);
        if (!circle) return;

        const author = await getUserPrivate(event.createdBy);
        if (!author) return;

        // Skip notifying the changer if they are the author (optional, mirrors other modules)
        if (author.did === changer.did) return;

        await sendNotifications(
            "event_status_changed",
            [author],
            sanitizeObjectForJSON({
                circle,
                user: changer,
                eventId: (event as any)._id?.toString?.() || String((event as any)._id),
                eventTitle: event.title,
                eventOldStage: oldStage,
                eventNewStage: event.stage,
            }),
        );
    } catch (err) {
        console.error("Error in notifyEventStatusChanged:", err);
    }
}

/**
 * Notify admins of a circle that it was added as an additional artist/band on an event.
 * Unlike the other notify* helpers here, the recipients are admins of the ARTIST circle
 * (circleId), not getEventCircle() — which only resolves the single host circleId and would
 * notify the wrong circle's admins entirely.
 */
export async function notifyAddedAsEventArtist(
    event: Pick<EventModel, "_id" | "title" | "circleId">,
    artistCircleId: string,
) {
    try {
        const artistCircle = await getCircleById(artistCircleId);
        if (!artistCircle) return;

        const hostCircle = await getEventCircle(event);

        const artistCircleMembers = await getMembers(artistCircleId);
        const adminDids = artistCircleMembers
            .filter((member) => member.userGroups?.includes("admins"))
            .map((member) => member.userDid)
            .filter((did): did is string => !!did);

        if (adminDids.length === 0) return;

        const adminPrivates = (await Promise.all(adminDids.map((did) => getUserPrivate(did)))).filter(
            (up): up is UserPrivate => up !== null,
        );
        if (adminPrivates.length === 0) return;

        await sendNotifications(
            "event_artist_added",
            adminPrivates,
            sanitizeObjectForJSON({
                circle: hostCircle, // host circle, so notification links resolve under its route
                artistCircle,
                eventId: (event as any)._id?.toString?.() || String((event as any)._id),
                eventName: event.title,
            }),
        );
    } catch (err) {
        console.error("Error in notifyAddedAsEventArtist:", err);
    }
}

/**
 * Notify admins of the target circle that a host-change request is awaiting their decision.
 * Like notifyAddedAsEventArtist, recipients are admins of the TARGET circle, not getEventCircle()
 * (the current/old host) — `circle` in the payload is deliberately the target so the
 * notification's link (settings/event-host-requests) resolves under the right circle's route.
 */
export async function notifyEventHostChangeRequested(
    event: Pick<EventModel, "_id" | "title">,
    targetCircleId: string,
    requester: Circle,
) {
    try {
        const targetCircle = await getCircleById(targetCircleId);
        if (!targetCircle) return;

        const targetMembers = await getMembers(targetCircleId);
        const adminDids = targetMembers
            .filter((member) => member.userGroups?.includes("admins"))
            .map((member) => member.userDid)
            .filter((did): did is string => !!did && did !== requester.did);

        if (adminDids.length === 0) return;

        const adminPrivates = (await Promise.all(adminDids.map((did) => getUserPrivate(did)))).filter(
            (up): up is UserPrivate => up !== null,
        );
        if (adminPrivates.length === 0) return;

        await sendNotifications(
            "event_host_change_requested",
            adminPrivates,
            sanitizeObjectForJSON({
                circle: targetCircle,
                user: requester,
                eventId: (event as any)._id?.toString?.() || String((event as any)._id),
                eventTitle: event.title,
            }),
        );
    } catch (err) {
        console.error("Error in notifyEventHostChangeRequested:", err);
    }
}

/**
 * Notify the requester that their host-change request was approved or rejected. `circle` in the
 * payload is the target circle (whether the request succeeded or not) so the notification's link
 * resolves under the right route once approved.
 */
export async function notifyEventHostChangeDecided(
    event: Pick<EventModel, "_id" | "title">,
    targetCircle: Circle,
    requesterDid: string,
    approved: boolean,
) {
    try {
        const requester = await getUserPrivate(requesterDid);
        if (!requester) return;

        await sendNotifications(
            "event_host_change_decided",
            [requester],
            sanitizeObjectForJSON({
                circle: targetCircle,
                eventId: (event as any)._id?.toString?.() || String((event as any)._id),
                eventTitle: event.title,
                approved,
            }),
        );
    } catch (err) {
        console.error("Error in notifyEventHostChangeDecided:", err);
    }
}
