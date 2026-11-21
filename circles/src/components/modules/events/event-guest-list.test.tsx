// Run: IS_BUILD=true bun test src/components/modules/events/event-guest-list.test.tsx
// Event guests, part 1 (2026-11-20): the event page's guest list for organisers. Attending and
// Interested, each person with their picture, name, the date of their reply, their message and a
// Message button (not on one's own row). Nothing for anyone else; a moderator or admin whose
// profile isn't verified sees why. The data comes from getEventGuestsAction (attendees.test.ts,
// event-guests-organisers.test.ts).

import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/app/circles/[handle]/events/actions", () => ({
    getEventGuestsAction: async () => null,
    confirmEventGuestAction: async () => ({ success: true }),
    unconfirmEventGuestAction: async () => ({ success: true }),
}));
mock.module("@/components/modules/chat/actions", () => ({
    findOrCreateDMConversationAction: async () => ({ success: false }),
    sendMongoMessageAction: async () => ({ success: false }),
}));

const { EventGuestListView, GUESTS_NEED_PROFILE_TEXT } = await import("./attendees-list");
const { fromYouText, GUEST_CANT_REPLY_NOTE } = await import("./message-guest-dialog");
type Result = Parameters<typeof EventGuestListView>[0]["result"];

const ORGANISER = "did:test:organiser";
const guest = (did: string, name: string, status: "going" | "interested", extra: Record<string, unknown> = {}) => ({
    user: { did, name, handle: name.toLowerCase(), picture: { url: `https://img.test/${name}.png` } },
    status,
    confirmed: false,
    since: new Date(Date.UTC(2026, 10, 20, 12)),
    ...extra,
});
const organiserResult: Result = {
    canSeeGuests: true,
    needsProfileToSeeGuests: false,
    guests: [
        guest("did:test:ann", "Ann", "going", { message: "Bringing a friend" }),
        guest("did:test:bo", "Bo", "interested"),
        guest(ORGANISER, "Org", "going"),
    ],
};
const render = (result: Result, withConfirm = false) =>
    renderToStaticMarkup(
        <EventGuestListView
            result={result}
            viewerDid={ORGANISER}
            onMessage={() => undefined}
            onOpenProfile={() => undefined}
            {...(withConfirm ? { onConfirm: () => undefined, onUnconfirm: () => undefined } : {})}
        />,
    );
const count = (html: string, text: string) => html.split(text).length - 1;

describe("event guest list", () => {
    test("organisers see Attending and Interested, with names, handles, dates and messages", () => {
        const html = render(organiserResult);
        expect(html).toContain("Guests");
        expect(html).toContain("Only the organisers see this list.");
        expect(html).toContain("Attending (2)");
        expect(html).toContain("Interested (1)");
        expect(html).toContain("Ann");
        expect(html).toContain("Bo");
        expect(html).toContain("since 20 Nov 2026");
        expect(html).toContain("Bringing a friend");
        expect(html).toContain("@ann");
    });

    test("a Message button on every row but the organiser's own", () => {
        expect(count(render(organiserResult), ">Message</button>")).toBe(2);
    });

    test("an empty group says so", () => {
        const html = render({ ...organiserResult, guests: [guest("did:test:ann", "Ann", "going")] });
        expect(html).toContain("Interested (0)");
        expect(html).toContain("Nobody yet.");
    });

    test("anyone else sees nothing, not even their own row", () => {
        const html = render({
            canSeeGuests: false,
            needsProfileToSeeGuests: false,
            guests: [guest(ORGANISER, "Org", "going")],
        });
        expect(html).toBe("");
    });

    test("a moderator whose profile isn't verified sees why, with a link to complete it", () => {
        const html = render({ canSeeGuests: false, needsProfileToSeeGuests: true, guests: [] });
        expect(html).toContain(GUESTS_NEED_PROFILE_TEXT.replace("'", "&#x27;"));
        expect(html).toContain('href="/onboarding/pilot"');
        expect(html).not.toContain("Attending");
    });

    test("the Message dialog says it comes from the organiser's own profile (D2)", () => {
        expect(fromYouText("Tim")).toBe(
            "They'll see this comes from you, Tim. Only the two of you see the conversation.",
        );
        expect(GUEST_CANT_REPLY_NOTE).toContain("can't reply until they do");
    });
});

describe("confirming guests on the list (part 2)", () => {
    const withConfirmations: Result = {
        canSeeGuests: true,
        needsProfileToSeeGuests: false,
        capacity: 2,
        confirmedCount: 1,
        guests: [
            { ...guest("did:test:ann", "Ann", "going"), confirmed: true },
            guest("did:test:cy", "Cy", "going"),
            guest("did:test:bo", "Bo", "interested"),
        ],
    };

    test("Attending rows have Confirm, or a Confirmed badge with Undo; Interested rows have neither", () => {
        const html = render(withConfirmations, true);
        expect(count(html, ">Confirmed</span>")).toBe(1);
        expect(count(html, ">Undo</button>")).toBe(1);
        expect(count(html, ">Confirm</button>")).toBe(1);
        expect(html).toContain("1 of 2 confirmed");
    });

    test("when all places are confirmed, Confirm is disabled", () => {
        const html = render({ ...withConfirmations, confirmedCount: 2 }, true);
        expect(html).toContain("2 of 2 confirmed (all places)");
        expect(/<button[^>]*disabled=""[^>]*title="All places are confirmed"[^>]*>Confirm<\/button>/.test(html)).toBe(
            true,
        );
    });

    test("no capacity: just the count", () => {
        const html = render({ ...withConfirmations, capacity: undefined }, true);
        expect(html).toContain("1 confirmed");
        expect(html).not.toContain('disabled=""');
    });
});

describe("row layout for the narrow column and phones (2026-11-21)", () => {
    // One row's markup: the <li> holding the given name.
    const rowOf = (html: string, name: string) =>
        html.split("<li").find((part) => part.includes(`>${name}</span>`)) ?? "";

    test("name and @handle first, the note below, then the buttons and the date on their own line", () => {
        const row = rowOf(render(organiserResult, true), "Ann");
        const at = (text: string) => row.indexOf(text);
        expect(at(">Ann</span>")).toBeGreaterThan(-1);
        expect(at("@ann")).toBeGreaterThan(at(">Ann</span>"));
        expect(at("Bringing a friend")).toBeGreaterThan(at("@ann"));
        expect(at(">Confirm</button>")).toBeGreaterThan(at("Bringing a friend"));
        expect(at(">Message</button>")).toBeGreaterThan(at(">Confirm</button>"));
        expect(at("since 20 Nov 2026")).toBeGreaterThan(at(">Message</button>"));
        // Stacked: the row is a column, and the buttons aren't a fixed-width side column.
        expect(row.startsWith(' class="flex min-w-0 flex-col')).toBe(true);
        expect(row).not.toContain("shrink-0 flex-wrap justify-end");
    });

    test("the Confirmed badge sits on the name line", () => {
        const html = render(
            { ...organiserResult, guests: [{ ...guest("did:test:ann", "Ann", "going"), confirmed: true }] },
            true,
        );
        const row = rowOf(html, "Ann");
        expect(row.indexOf(">Confirmed</span>")).toBeGreaterThan(row.indexOf("@ann"));
        expect(row.indexOf("</button>")).toBeGreaterThan(row.indexOf(">Confirmed</span>"));
    });
});
