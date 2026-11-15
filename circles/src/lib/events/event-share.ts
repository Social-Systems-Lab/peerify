// Sharing an event (Crew R1, item 5, 2026-11-14): the short text crew and guests can paste
// (title, date, place, link), and the "Sign in to RSVP" link that comes back to the event.
// Built from the event the viewer already has (shaped on the server), and the place is never more
// than the city or the organiser's public label, even for viewers who get the street.

import { format } from "date-fns";
import type { EventDisplay } from "@/models/models";

type ShareableEvent = Pick<EventDisplay, "title" | "startAt" | "isVirtual" | "location" | "metadata">;

export const eventPath = (circleHandle: string, eventId: string) =>
    `/circles/${encodeURIComponent(circleHandle)}/events/${encodeURIComponent(eventId)}`;

// Only a path on this site goes into redirectTo.
export const eventSignInHref = (circleHandle: string, eventId: string) =>
    `/login?redirectTo=${encodeURIComponent(eventPath(circleHandle, eventId))}`;

export const eventSharePlace = (event: ShareableEvent): string | undefined => {
    if (event.isVirtual) return "Online";
    const peerify = (event.metadata as { peerify?: { publicLocationLabel?: unknown } } | undefined)?.peerify;
    const label = typeof peerify?.publicLocationLabel === "string" ? peerify.publicLocationLabel.trim() : "";
    if (label) return label;
    const location = event.location;
    if (!location) return undefined;
    return [location.city, location.country].filter(Boolean).join(", ") || undefined;
};

export const buildEventShareText = (event: ShareableEvent, url: string): string => {
    const start = event.startAt ? new Date(event.startAt) : null;
    const when = start && !Number.isNaN(start.getTime()) ? format(start, "EEE d MMM, HH:mm") : undefined;
    const lines = [event.title || "Event", [when, eventSharePlace(event)].filter(Boolean).join(" · "), url];
    return lines.filter(Boolean).join("\n");
};

// What goes to the system share sheet. Only `text`, which already holds the title and the link: with
// a separate `title`, macOS (and some apps) put the title in front of the text, so it showed twice
// (Tim, 2026-11-15). No separate `url` either, or the link could show twice the same way.
export const buildEventSharePayload = (event: ShareableEvent, url: string): ShareData => ({
    text: buildEventShareText(event, url),
});
