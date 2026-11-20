// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/event-guest-note.test.ts"
// Event guests, part 2 (2026-11-20): the note for confirmed guests (e.g. the exact address) goes only
// to confirmed guests and the event's organisers, as the shift participants note (decision B). Someone
// who clicked Attend and isn't confirmed yet is told details come once they are; Interested people,
// invitees, other members and signed-out visitors get nothing. D7: for an event whose address is
// "revealed after acceptance", a confirmed guest gets the exact location, on the page and in the
// calendar export (getEventLocationForViewer). In-memory fakes; session and permissions stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const HOST_ID = "64e500000000000000000001";
const OTHER_ID = "64e500000000000000000002";
const EVENT_ID = "64e5000000000000000000e1";
const CREATOR = "did:test:creator";
const ORGANISER = "did:test:organiser";
const CONFIRMED = "did:test:confirmed";
const GOING = "did:test:going";
const FAN = "did:test:fan";
const INVITEE = "did:test:invitee";
const MEMBER = "did:test:member";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) => {
        if (!did || String(circleId) !== HOST_ID) return false;
        if (feature === features.events.view) return true;
        return feature === features.events.guests && did === ORGANISER;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getEventGuestDetailsAction } = await import("./actions");
const { getEventLocationForViewer } = await import("@/lib/data/event");

const NOTE = "Canary guest note: gate code 2580";
const STREET = "Kloofnek Road 7";
const LOCATION = { precision: 4, city: "Cape Town", street: STREET, lngLat: { lng: 18.4, lat: -33.95 } };

const eventDoc = (peerify: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
    circleId: HOST_ID,
    createdBy: CREATOR,
    title: "Home show",
    stage: "open",
    visibility: "public",
    userGroups: [],
    invitations: [INVITEE],
    location: LOCATION,
    metadata: { peerify: { locationDisclosure: "public", guestNote: NOTE, ...peerify } },
    guestConfirmations: [{ userDid: CONFIRMED, confirmedAt: new Date(), confirmedBy: ORGANISER }],
    ...extra,
});
const seed = (peerify: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
    const doc = eventDoc(peerify, extra);
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(HOST_ID), did: "did:test:host", handle: "host", name: "Host", circleType: "circle" },
            {
                _id: new ObjectId(OTHER_ID),
                did: "did:test:other",
                handle: "other",
                name: "Other",
                circleType: "circle",
            },
        ],
        Events: [{ _id: new ObjectId(EVENT_ID), ...doc }],
        EventRsvps: [
            { eventId: EVENT_ID, circleId: HOST_ID, userDid: CONFIRMED, status: "going" },
            { eventId: EVENT_ID, circleId: HOST_ID, userDid: GOING, status: "going" },
            { eventId: EVENT_ID, circleId: HOST_ID, userDid: FAN, status: "interested" },
        ],
        EventInvitations: [],
        Members: [],
    });
    // getEventById's stored shape: no guestConfirmations (in neither projection).
    const { guestConfirmations: _hidden, ...projected } = doc;
    fakeDb.setAggregateResult("Events", [{ _id: EVENT_ID, ...projected, confirmedGuests: 1 }]);
};
const detailsFor = async (did: string | undefined) => {
    sessionDid = did;
    return getEventGuestDetailsAction("host", EVENT_ID);
};

beforeEach(() => seed());

describe("the note for confirmed guests", () => {
    test("a confirmed guest gets it", async () => {
        expect(await detailsFor(CONFIRMED)).toEqual({
            isConfirmed: true,
            detailsAfterConfirmation: false,
            guestNote: NOTE,
        });
    });

    test("the event's organisers get it too", async () => {
        expect((await detailsFor(ORGANISER)).guestNote).toBe(NOTE);
        expect((await detailsFor(CREATOR)).guestNote).toBe(NOTE);
    });

    test("someone who clicked Attend and isn't confirmed: no note, but told details come once confirmed", async () => {
        const details = await detailsFor(GOING);
        expect(details).toEqual({ isConfirmed: false, detailsAfterConfirmation: true });
        expect(JSON.stringify(details)).not.toContain("gate code");
    });

    test("Interested, an invitee, another member and a signed-out visitor get nothing", async () => {
        for (const did of [FAN, INVITEE, MEMBER, undefined]) {
            const details = await detailsFor(did);
            expect(details).toEqual({ isConfirmed: false, detailsAfterConfirmation: false });
        }
    });

    test("nothing through another circle's URL", async () => {
        const { guestConfirmations: _hidden, ...projected } = eventDoc({}, { circleId: OTHER_ID });
        fakeDb.setAggregateResult("Events", [{ _id: EVENT_ID, ...projected }]);
        expect(await detailsFor(CONFIRMED)).toEqual({ isConfirmed: false, detailsAfterConfirmation: false });
    });

    test("no note on the event: a pending guest isn't told anything is waiting", async () => {
        seed({ guestNote: undefined });
        expect(await detailsFor(GOING)).toEqual({ isConfirmed: false, detailsAfterConfirmation: false });
        expect(await detailsFor(CONFIRMED)).toEqual({ isConfirmed: true, detailsAfterConfirmation: false });
    });
});

describe("D7: the address revealed after acceptance", () => {
    test("a confirmed guest gets the exact location; a pending guest only hears it's coming", async () => {
        seed({ locationDisclosure: "secret_after_acceptance" });
        expect((await detailsFor(CONFIRMED)).location?.street).toBe(STREET);
        const pending = await detailsFor(GOING);
        expect(pending.location).toBeUndefined();
        expect(pending.detailsAfterConfirmation).toBe(true);
        expect(JSON.stringify(await detailsFor(FAN))).not.toContain(STREET);
    });

    test("a public address isn't repeated in the details", async () => {
        expect((await detailsFor(CONFIRMED)).location).toBeUndefined();
    });

    test("the calendar export gives a confirmed guest the street, others the area only", async () => {
        const stored = eventDoc({ locationDisclosure: "secret_after_acceptance" }) as any;
        expect((await getEventLocationForViewer(stored, CONFIRMED))?.street).toBe(STREET);
        for (const did of [GOING, FAN, MEMBER, undefined]) {
            const location = await getEventLocationForViewer(stored, did);
            expect(location?.street).toBeUndefined();
            expect(location?.lngLat).toBeUndefined();
        }
    });

    test("other hidden disclosures stay hidden from confirmed guests", async () => {
        const approximate = eventDoc({ locationDisclosure: "approximate" }) as any;
        expect((await getEventLocationForViewer(approximate, CONFIRMED))?.street).toBeUndefined();
    });
});
