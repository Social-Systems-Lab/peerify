// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/public-events-only.test.ts"
// Round 3, item 1 (2026-10-20): events are public only for now. Create/update reject the hidden
// location disclosures and "private" visibility; an existing event may keep what it has. Event
// pages (getEventAction) send a hidden address or the private organiser note only to the event's
// managers, and only for an event of the circle in the URL (or one the viewer may see anyway).
// In-memory fakes (testing/fake-db.ts), session and permissions stubbed. The tests that check
// rejection, shaping and the circle check fail on the code before this change.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const HOST_ID = "64b000000000000000000001";
const OTHER_ID = "64b000000000000000000002";
const EVENT_ID = "64b0000000000000000000e1";
const AUTHOR = "did:test:author";
const MEMBER = "did:test:member";
const MODERATOR = "did:test:moderator";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    // Everyone signed in may view and create events in HOST only; MODERATOR moderates HOST.
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) => {
        if (!did || String(circleId) !== HOST_ID) return false;
        if (feature === features.events.view || feature === features.events.create) return true;
        if (feature === features.events.moderate) return did === MODERATOR;
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getEventAction, createEventAction, updateEventAction } = await import("./actions");

const STREET = "Hemvägen 12";
const NOTE = "Door code 4321";
const storedEvent = (extra: Record<string, unknown> = {}) => ({
    _id: EVENT_ID,
    circleId: HOST_ID,
    title: "Living room show",
    description: "x",
    stage: "open",
    visibility: "public",
    createdBy: AUTHOR,
    startAt: new Date("2026-11-01T18:00:00Z"),
    endAt: new Date("2026-11-01T21:00:00Z"),
    location: { precision: 4, city: "Uppsala", street: STREET, lngLat: { lng: 17.64, lat: 59.85 } },
    metadata: { peerify: { locationDisclosure: "approximate", privateLocationNote: NOTE } },
    ...extra,
});
const leaks = (output: unknown) => {
    const text = JSON.stringify(output) ?? "";
    return { street: text.includes(STREET), note: text.includes(NOTE) };
};

const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    const base: Record<string, string> = {
        title: "Gig",
        description: "A gig",
        startAt: "2026-11-02T18:00:00.000Z",
        endAt: "2026-11-02T21:00:00.000Z",
        visibility: "public",
        location: JSON.stringify({ precision: 2, city: "Uppsala", lngLat: { lng: 17.6, lat: 59.8 } }),
        peerifyEventMetadata: JSON.stringify({ locationDisclosure: "public" }),
    };
    for (const [k, v] of Object.entries({ ...base, ...fields })) fd.set(k, v);
    return fd;
};
const disclosure = (value: string) => JSON.stringify({ locationDisclosure: value });
const HIDDEN = "Events can only be public, with a public address, for now.";

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(HOST_ID), did: "did:test:host", handle: "host", name: "Host", circleType: "circle" },
            { _id: new ObjectId(OTHER_ID), did: "did:test:other", handle: "other", name: "Other", circleType: "circle" },
            { _id: "u-author", did: AUTHOR, handle: "author", name: "Author", circleType: "user" },
            { _id: "u-member", did: MEMBER, handle: "member", name: "Member", circleType: "user" },
            { _id: "u-mod", did: MODERATOR, handle: "mod", name: "Mod", circleType: "user" },
        ],
    });
    fakeDb.setAggregateResult("Events", [storedEvent()]);
});

describe("getEventAction (event page)", () => {
    test("a member who doesn't manage the event gets no hidden address and no private note", async () => {
        sessionDid = MEMBER;
        const event = await getEventAction("host", EVENT_ID);
        expect(event).not.toBeNull();
        expect(leaks(event)).toEqual({ street: false, note: false });
    });

    test("a public-disclosure event still shows its address to members, but never the private note", async () => {
        fakeDb.setAggregateResult("Events", [
            storedEvent({ metadata: { peerify: { locationDisclosure: "public", privateLocationNote: NOTE } } }),
        ]);
        sessionDid = MEMBER;
        expect(leaks(await getEventAction("host", EVENT_ID))).toEqual({ street: true, note: false });
    });

    test("the author and a moderator get the full event", async () => {
        sessionDid = AUTHOR;
        expect(leaks(await getEventAction("host", EVENT_ID))).toEqual({ street: true, note: true });
        sessionDid = MODERATOR;
        expect(leaks(await getEventAction("host", EVENT_ID))).toEqual({ street: true, note: true });
    });

    test("an event of a circle the viewer can't see isn't served through another circle's URL", async () => {
        fakeDb.setAggregateResult("Events", [storedEvent({ circleId: OTHER_ID })]);
        sessionDid = MEMBER;
        expect(await getEventAction("host", EVENT_ID)).toBeNull();
    });
});

describe("createEventAction", () => {
    test("rejects a hidden location disclosure", async () => {
        sessionDid = AUTHOR;
        for (const value of ["approximate", "secret_after_acceptance", "to_be_disclosed"]) {
            const result = await createEventAction("host", form({ peerifyEventMetadata: disclosure(value) }));
            expect(result).toEqual({ success: false, message: HIDDEN });
        }
    });

    test("rejects private visibility", async () => {
        sessionDid = AUTHOR;
        const result = await createEventAction("host", form({ visibility: "private" }));
        expect(result).toEqual({ success: false, message: HIDDEN });
    });

    test("a public event isn't rejected by the check", async () => {
        sessionDid = AUTHOR;
        const result = await createEventAction("host", form({}));
        expect(result.message).not.toBe(HIDDEN);
    });
});

// Follow-up (2026-10-20): the rest of the "Venue & location privacy" section is hidden too, so
// venueDisclosure and accessMode only take their public defaults on create and update.
const privacy = (fields: Record<string, string>) =>
    JSON.stringify({ locationDisclosure: "public", venueDisclosure: "public", accessMode: "open_rsvp", ...fields });

describe("venue / host display and access mode", () => {
    test("create rejects a hidden venue display or a non-open access mode", async () => {
        sessionDid = AUTHOR;
        const cases: Record<string, string>[] = [
            { venueDisclosure: "secret_after_acceptance" },
            { venueDisclosure: "venue_to_be_disclosed" },
            { venueDisclosure: "one_off_location" },
            { accessMode: "approval_required" },
            { accessMode: "invite_only" },
            { accessMode: "ticket_required" },
        ];
        for (const fields of cases) {
            const result = await createEventAction("host", form({ peerifyEventMetadata: privacy(fields) }));
            expect({ fields, result }).toEqual({ fields, result: { success: false, message: HIDDEN } });
        }
    });

    test("create with the public defaults isn't rejected by the check", async () => {
        sessionDid = AUTHOR;
        const result = await createEventAction("host", form({ peerifyEventMetadata: privacy({}) }));
        expect(result.message).not.toBe(HIDDEN);
    });

    test("update can't switch a public event to a hidden venue display or another access mode", async () => {
        fakeDb.setAggregateResult("Events", [storedEvent({ metadata: { peerify: { locationDisclosure: "public" } } })]);
        sessionDid = AUTHOR;
        const cases: Record<string, string>[] = [
            { venueDisclosure: "secret_after_acceptance" },
            { accessMode: "approval_required" },
        ];
        for (const fields of cases) {
            const result = await updateEventAction("host", EVENT_ID, form({ peerifyEventMetadata: privacy(fields) }));
            expect({ fields, result }).toEqual({ fields, result: { success: false, message: HIDDEN } });
        }
    });

    test("an existing event keeps its saved venue display and access mode", async () => {
        fakeDb.setAggregateResult("Events", [
            storedEvent({
                metadata: {
                    peerify: {
                        locationDisclosure: "approximate",
                        venueDisclosure: "secret_after_acceptance",
                        accessMode: "approval_required",
                    },
                },
            }),
        ]);
        sessionDid = AUTHOR;
        const saved = privacy({
            locationDisclosure: "approximate",
            venueDisclosure: "secret_after_acceptance",
            accessMode: "approval_required",
        });
        const result = await updateEventAction("host", EVENT_ID, form({ peerifyEventMetadata: saved }));
        expect(result.message).not.toBe(HIDDEN);
    });
});

describe("updateEventAction", () => {
    test("can't switch a public event to a hidden disclosure or to private", async () => {
        fakeDb.setAggregateResult("Events", [storedEvent({ metadata: { peerify: { locationDisclosure: "public" } } })]);
        sessionDid = AUTHOR;
        expect(await updateEventAction("host", EVENT_ID, form({ peerifyEventMetadata: disclosure("approximate") }))).toEqual({
            success: false,
            message: HIDDEN,
        });
        expect(await updateEventAction("host", EVENT_ID, form({ visibility: "private" }))).toEqual({
            success: false,
            message: HIDDEN,
        });
    });

    test("an existing hidden-disclosure or private event can keep what it has", async () => {
        fakeDb.setAggregateResult("Events", [storedEvent({ visibility: "private" })]);
        sessionDid = AUTHOR;
        const result = await updateEventAction(
            "host",
            EVENT_ID,
            form({ visibility: "private", peerifyEventMetadata: disclosure("approximate") }),
        );
        expect(result.message).not.toBe(HIDDEN);
    });
});
