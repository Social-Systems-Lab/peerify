// Refreshing an open event page when a guest's confirmation changes (2026-11-21). Clicking the
// "You're confirmed" notice links to the event page; when that page is already open, the link alone
// changes nothing (the RSVP box's guest details are fetched in the browser, keyed on the viewer's own
// RSVP, which hasn't changed). So the notice also tells the page to reload them, through a window
// event. And while a guest who clicked Attend waits on the page, a rise in their unread notice count
// (the header checks it every 15 seconds) makes the page check again.

export const EVENT_GUEST_UPDATED = "peerify:event-guest-updated";

// Recurring occurrences have ids like "<eventId>_<date>"; confirmations are on the base event.
const baseEventId = (eventId?: string | null) => String(eventId ?? "").split("_")[0];

// Notice types that change what an event's RSVP box shows the person who gets them.
const EVENT_GUEST_NOTICE_TYPES = new Set(["event_guest_confirmed"]);

/** Tell an open event page to reload its RSVP details. Does nothing outside the browser. */
export const announceEventGuestUpdate = (eventId: string) => {
    if (typeof window === "undefined" || !eventId) return;
    window.dispatchEvent(new CustomEvent(EVENT_GUEST_UPDATED, { detail: { eventId: baseEventId(eventId) } }));
};

/** For the bell: announce when a clicked notice is about the viewer's place at an event. */
export const announceIfEventGuestNotice = (notification: { notificationType?: string; eventId?: string }) => {
    if (!notification.eventId || !EVENT_GUEST_NOTICE_TYPES.has(notification.notificationType ?? "")) return false;
    announceEventGuestUpdate(notification.eventId);
    return true;
};

/** Whether a window event is an update for this event page. */
export const isEventGuestUpdateFor = (event: Event, eventId: string) =>
    !!eventId && (event as CustomEvent<{ eventId?: string }>).detail?.eventId === baseEventId(eventId);

/**
 * Whether the event page should check the guest details again because new notices arrived: only for
 * someone who clicked Attend and isn't confirmed yet, so it costs one request per new notice, on that
 * page only.
 */
export const shouldRecheckGuestDetails = (
    previousUnread: number | undefined,
    unread: number,
    rsvpStatus: string | undefined,
    isConfirmed: boolean,
) => previousUnread !== undefined && unread > previousUnread && rsvpStatus === "going" && !isConfirmed;
