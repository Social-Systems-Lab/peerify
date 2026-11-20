// Run: IS_BUILD=true bun test src/components/modules/events/rsvp-panel.test.tsx
// Event guests, part 2 (2026-11-20): the RSVP box on an event page and popup. "N tickets left" /
// "Sold out" for ticketed events, places / Full otherwise (D5); when full, Attend becomes "Join the
// waiting list" and an unconfirmed guest reads as on the waiting list (D8); a confirmed guest sees
// "You're confirmed" and can't cancel (D4); the note for confirmed guests and a hidden address only
// when the server sent them, and "Details for guests appear once you're confirmed." otherwise.

import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RsvpPanel, { CONFIRMED_CONTACT_ORGANISERS, GUEST_DETAILS_AFTER_CONFIRMATION } from "./rsvp-panel";

type Props = Parameters<typeof RsvpPanel>[0];
const noop = () => undefined;
const render = (overrides: Partial<Props> = {}, event: Partial<Props["event"]> = {}) =>
    renderToStaticMarkup(
        <RsvpPanel
            event={{ attendees: 5, userRsvpStatus: "none", ...event }}
            size="full"
            signedIn
            signInHref="/signin"
            isPending={false}
            onAttend={noop}
            onInterested={noop}
            onCancel={noop}
            {...overrides}
        />,
    );
const ticketed = { metadata: { peerify: { ticketed: true } } };
const NOTE = "Gate code 2580";

describe("places left (D5) and the waiting list (D8)", () => {
    test("no capacity: only the count, and Attend", () => {
        const html = render();
        expect(html).toContain("Attendees (going): 5");
        expect(html).not.toContain(" left");
        expect(html).toContain(">Attend</button>");
    });

    test("a ticketed event with room: tickets left", () => {
        const html = render({}, { ...ticketed, capacity: 30, confirmedGuests: 27 });
        expect(html).toContain("3 tickets left");
        expect(html).toContain(">Attend</button>");
    });

    test("sold out: Attend becomes Join the waiting list", () => {
        const html = render({}, { ...ticketed, capacity: 30, confirmedGuests: 30 });
        expect(html).toContain("Sold out");
        expect(html).toContain(">Join the waiting list</button>");
        expect(html).not.toContain(">Attend</button>");
    });

    test("not ticketed: places left, then Full", () => {
        expect(render({}, { capacity: 10, confirmedGuests: 4 })).toContain("6 places left");
        expect(render({}, { capacity: 10, confirmedGuests: 10 })).toContain("Full");
    });

    test("someone who clicked Attend on a full event and isn't confirmed is on the waiting list", () => {
        const html = render(
            { guestDetails: { isConfirmed: false, detailsAfterConfirmation: false } },
            { capacity: 2, confirmedGuests: 2, userRsvpStatus: "going" },
        );
        expect(html).toContain("Your status: on the waiting list");
        expect(html).toContain(">Cancel RSVP</button>");
    });

    test("signed out: Sign in to RSVP, and the places left still show", () => {
        const html = render({ signedIn: false }, { capacity: 10, confirmedGuests: 4 });
        expect(html).toContain("Sign in to RSVP");
        expect(html).toContain("6 places left");
    });
});

describe("a confirmed guest (D4)", () => {
    const confirmed = { guestDetails: { isConfirmed: true, detailsAfterConfirmation: false, guestNote: NOTE } };

    test("sees You're confirmed, no Cancel or Interested, and the note", () => {
        const html = render(confirmed, { userRsvpStatus: "going" });
        expect(html).toContain("You&#x27;re confirmed.");
        expect(html).toContain(CONFIRMED_CONTACT_ORGANISERS);
        expect(html).not.toContain("Cancel RSVP");
        expect(html).not.toContain(">Interested</button>");
        expect(html).toContain("Your status: confirmed");
        expect(html).toContain("For guests");
        expect(html).toContain(NOTE);
    });

    test("D7: sees the address when the server sent it", () => {
        const html = render(
            {
                guestDetails: {
                    isConfirmed: true,
                    detailsAfterConfirmation: false,
                    location: { street: "Kloofnek Road 7", city: "Cape Town" } as any,
                },
            },
            { userRsvpStatus: "going" },
        );
        expect(html).toContain("Address: Kloofnek Road 7, Cape Town");
    });
});

describe("guest details for everyone else", () => {
    test("someone who clicked Attend and isn't confirmed is told details come once confirmed", () => {
        const html = render(
            { guestDetails: { isConfirmed: false, detailsAfterConfirmation: true } },
            { userRsvpStatus: "going" },
        );
        expect(html).toContain(GUEST_DETAILS_AFTER_CONFIRMATION.replace("'", "&#x27;"));
        expect(html).not.toContain("For guests");
    });

    test("an organiser sees the note labelled as what confirmed guests see", () => {
        const html = render({
            isOrganiser: true,
            guestDetails: { isConfirmed: false, detailsAfterConfirmation: false, guestNote: NOTE },
        });
        expect(html).toContain("Note for confirmed guests");
        expect(html).toContain("Only confirmed guests and the organisers see this.");
        expect(html).toContain(NOTE);
    });

    test("no details from the server: nothing about guests", () => {
        const html = render({ guestDetails: null });
        expect(html).not.toContain("For guests");
        expect(html).not.toContain("once you");
    });
});
