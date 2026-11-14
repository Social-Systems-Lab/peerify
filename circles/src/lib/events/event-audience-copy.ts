// Wording of the event form's audience picker (Crew R1, item 9, 2026-11-14). Since H5 (2026-11-05)
// the choice decides who can see the event itself (its page, the events list, the map and the
// calendar export) as well as its linked Noticeboard post, so the picker must say so.

export const EVENT_AUDIENCE_COPY = {
    buttonPrefix: "Visible to:",
    dialogTitle: "Who can see this event?",
    dialogBody:
        "This decides who can see the event itself (its page, the events list, the map and calendar downloads) and its Noticeboard post.",
} as const;
