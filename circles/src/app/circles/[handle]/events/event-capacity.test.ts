// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/event-capacity.test.ts"
// Event guests, part 2 (2026-11-20): an event's capacity is a whole number of at least 1, or empty
// (no limit). Before, the form's value went through Number() unchecked, so a crafted request could
// store NaN, a negative or a fraction. Capacity also can't go below the guests already confirmed:
// the check runs before any upload, and the capacity write itself carries the condition.
// In-memory fakes; session and permissions stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";
import {
    EVENT_CAPACITY_INVALID,
    PLACES_TAKEN_OUTSIDE_INVALID,
    formatEventPlacesLeft,
    parseEventCapacity,
    parsePlacesTakenOutside,
} from "@/lib/events/guest-capacity";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const HOST_ID = "64e300000000000000000001";
const EVENT_ID = "64e3000000000000000000e1";
const AUTHOR = "did:test:author";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) =>
        !!did &&
        String(circleId) === HOST_ID &&
        (feature === features.events.view || feature === features.events.create),
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { createEventAction, updateEventAction } = await import("./actions");

const confirmation = (n: number) => ({ userDid: `did:test:g${n}`, confirmedAt: new Date(), confirmedBy: AUTHOR });
const storedEvent = (extra: Record<string, unknown> = {}) => ({
    circleId: HOST_ID,
    title: "Home show",
    description: "x",
    stage: "open",
    visibility: "public",
    createdBy: AUTHOR,
    startAt: new Date("2026-12-06T17:00:00Z"),
    endAt: new Date("2026-12-06T20:00:00Z"),
    metadata: { peerify: { locationDisclosure: "public" } },
    ...extra,
});
const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    const base: Record<string, string> = {
        title: "Home show",
        description: "A home show",
        startAt: "2026-12-06T17:00:00.000Z",
        endAt: "2026-12-06T20:00:00.000Z",
        visibility: "public",
        location: JSON.stringify({ precision: 2, city: "Cape Town", lngLat: { lng: 18.4, lat: -33.9 } }),
        peerifyEventMetadata: JSON.stringify({ locationDisclosure: "public" }),
    };
    for (const [k, v] of Object.entries({ ...base, ...fields })) fd.set(k, v);
    return fd;
};
const seed = (extra: Record<string, unknown> = {}) => {
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(HOST_ID), did: "did:test:host", handle: "host", name: "Host", circleType: "circle" },
            { _id: "u-author", did: AUTHOR, handle: "author", name: "Author", circleType: "user" },
        ],
        Events: [{ _id: new ObjectId(EVENT_ID), ...storedEvent(extra) }],
        Feeds: [],
        Posts: [],
    });
    fakeDb.setAggregateResult("Events", [{ _id: EVENT_ID, ...storedEvent(extra) }]);
    // updateEvent $sets fields the form left empty to undefined; the real driver (no ignoreUndefined)
    // stores null, where the fake would throw. Do as the driver does.
    const events = fakeDb.col("Events");
    const realUpdateOne = events.updateOne.bind(events);
    (events as any).updateOne = (filter: any, update: any, options?: any) => {
        const $set = update?.$set
            ? Object.fromEntries(Object.entries(update.$set).map(([k, v]) => [k, v === undefined ? null : v]))
            : undefined;
        return realUpdateOne(filter, $set ? { ...update, $set } : update, options);
    };
};
const storedCapacity = () => fakeDb.col("Events").docs[0]?.capacity;

beforeEach(() => {
    sessionDid = AUTHOR;
    seed();
});

describe("parseEventCapacity", () => {
    test("empty means no limit; whole numbers from 1 are kept", () => {
        expect(parseEventCapacity(undefined)).toEqual({ ok: true, capacity: undefined });
        expect(parseEventCapacity("  ")).toEqual({ ok: true, capacity: undefined });
        expect(parseEventCapacity("40")).toEqual({ ok: true, capacity: 40 });
    });

    test("zero, negatives, fractions, text and huge numbers are refused", () => {
        for (const raw of ["0", "-3", "2.5", "abc", "NaN", "1e9"]) {
            expect(parseEventCapacity(raw)).toEqual({ ok: false, message: EVENT_CAPACITY_INVALID });
        }
    });
});

describe("formatEventPlacesLeft (D5)", () => {
    test("no capacity: nothing to show", () => {
        expect(formatEventPlacesLeft({ confirmedGuests: 3 })).toBeNull();
    });

    test("a ticketed event: tickets left, then Sold out", () => {
        const ticketed = { metadata: { peerify: { ticketed: true } } };
        expect(formatEventPlacesLeft({ ...ticketed, capacity: 30, confirmedGuests: 27 })).toEqual({
            text: "3 tickets left",
            full: false,
        });
        expect(formatEventPlacesLeft({ ...ticketed, capacity: 30, confirmedGuests: 29 })?.text).toBe("1 ticket left");
        expect(formatEventPlacesLeft({ ...ticketed, capacity: 30, confirmedGuests: 30 })).toEqual({
            text: "Sold out",
            full: true,
        });
    });

    test("not ticketed: places left, then Full", () => {
        expect(formatEventPlacesLeft({ capacity: 10 })).toEqual({ text: "10 places left", full: false });
        expect(formatEventPlacesLeft({ capacity: 2, confirmedGuests: 1 })?.text).toBe("1 place left");
        expect(formatEventPlacesLeft({ capacity: 2, confirmedGuests: 2 })).toEqual({ text: "Full", full: true });
    });
});

describe("capacity on create and update", () => {
    test("create refuses an invalid capacity", async () => {
        for (const capacity of ["0", "-1", "2.5", "lots"]) {
            expect(await createEventAction("host", form({ capacity }))).toEqual({
                success: false,
                message: EVENT_CAPACITY_INVALID,
            });
        }
    });

    test("update refuses an invalid capacity and keeps the old one", async () => {
        seed({ capacity: 20 });
        expect(await updateEventAction("host", EVENT_ID, form({ capacity: "-5" }))).toEqual({
            success: false,
            message: EVENT_CAPACITY_INVALID,
        });
        expect(storedCapacity()).toBe(20);
    });

    test("update can't set the capacity below the confirmed guests", async () => {
        seed({ capacity: 3, guestConfirmations: [confirmation(1), confirmation(2)] });
        expect(await updateEventAction("host", EVENT_ID, form({ capacity: "1" }))).toEqual({
            success: false,
            message: "2 guests are confirmed, so the capacity can't be lower than 2.",
        });
        expect(storedCapacity()).toBe(3);
    });

    test("update can set the capacity to exactly the confirmed guests, or raise it", async () => {
        seed({ capacity: 3, guestConfirmations: [confirmation(1), confirmation(2)] });
        expect((await updateEventAction("host", EVENT_ID, form({ capacity: "2" }))).success).toBe(true);
        expect(storedCapacity()).toBe(2);
        expect((await updateEventAction("host", EVENT_ID, form({ capacity: "50" }))).success).toBe(true);
        expect(storedCapacity()).toBe(50);
    });

    test("the capacity write itself carries the condition (a confirm landing after the first check)", async () => {
        seed({ capacity: 5, guestConfirmations: [confirmation(1)] });
        const events = fakeDb.col("Events");
        const realFindOne = events.findOne.bind(events);
        // The early check reads one confirmed guest; by the time of the write there are three.
        let reads = 0;
        (events as any).findOne = async (...args: any[]) => {
            const doc = await realFindOne(...(args as [any]));
            if (doc?.guestConfirmations && ++reads === 1) {
                events.docs[0].guestConfirmations = [confirmation(1), confirmation(2), confirmation(3)];
                return { ...doc, guestConfirmations: [confirmation(1)] };
            }
            return doc;
        };
        const result = await updateEventAction("host", EVENT_ID, form({ capacity: "2" }));
        (events as any).findOne = realFindOne;
        expect(result).toEqual({
            success: false,
            message: "3 guests are confirmed, so the capacity can't be lower than 3.",
        });
        expect(storedCapacity()).toBe(5);
    });
});

describe("the note for confirmed guests in the event form", () => {
    const peerify = () => fakeDb.col("Events").docs[0]?.metadata?.peerify ?? {};
    const withNote = (guestNote: string) =>
        form({ peerifyEventMetadata: JSON.stringify({ locationDisclosure: "public", guestNote }) });

    test("is saved trimmed, and an empty field clears it", async () => {
        expect((await updateEventAction("host", EVENT_ID, withNote("  Gate code 2580  "))).success).toBe(true);
        expect(peerify().guestNote).toBe("Gate code 2580");
        // getEventById now returns what was saved.
        fakeDb.setAggregateResult("Events", [{ ...fakeDb.col("Events").docs[0], _id: EVENT_ID }]);
        expect((await updateEventAction("host", EVENT_ID, withNote(""))).success).toBe(true);
        expect(peerify().guestNote).toBeUndefined();
    });
});

// Places taken outside Peerify (2026-11-22): places sold elsewhere count against the capacity like
// confirmed guests. Stored as metadata.peerify.placesTakenOutside.
describe("places taken outside Peerify", () => {
    const stored = () => fakeDb.col("Events").docs[0];
    const storedOutside = () => stored()?.metadata?.peerify?.placesTakenOutside;
    const withConfirmed = (n: number) => Array.from({ length: n }, (_, i) => confirmation(i + 1));

    test("parse: empty means none; whole numbers from 0 are kept; anything else is refused", () => {
        expect(parsePlacesTakenOutside(undefined)).toEqual({ ok: true, value: 0 });
        expect(parsePlacesTakenOutside(" ")).toEqual({ ok: true, value: 0 });
        expect(parsePlacesTakenOutside("0")).toEqual({ ok: true, value: 0 });
        expect(parsePlacesTakenOutside("5")).toEqual({ ok: true, value: 5 });
        for (const raw of ["-1", "2.5", "abc", "1e9"]) {
            expect(parsePlacesTakenOutside(raw)).toEqual({ ok: false, message: PLACES_TAKEN_OUTSIDE_INVALID });
        }
    });

    test("create refuses a negative number, and more outside places than the capacity", async () => {
        expect(await createEventAction("host", form({ capacity: "10", placesTakenOutside: "-2" }))).toEqual({
            success: false,
            message: PLACES_TAKEN_OUTSIDE_INVALID,
        });
        expect(await createEventAction("host", form({ capacity: "5", placesTakenOutside: "6" }))).toEqual({
            success: false,
            message: "6 places are taken outside Peerify, so the capacity can't be lower than 6.",
        });
    });

    test("update saves it, and an empty field or 0 clears it", async () => {
        seed({ capacity: 20 });
        expect(
            (await updateEventAction("host", EVENT_ID, form({ capacity: "20", placesTakenOutside: "5" }))).success,
        ).toBe(true);
        expect(storedOutside()).toBe(5);
        fakeDb.setAggregateResult("Events", [{ ...stored(), _id: EVENT_ID }]);
        expect(
            (await updateEventAction("host", EVENT_ID, form({ capacity: "20", placesTakenOutside: "0" }))).success,
        ).toBe(true);
        expect(storedOutside()).toBeUndefined();
    });

    test("update refuses a negative number and keeps what was stored", async () => {
        seed({ capacity: 20, metadata: { peerify: { locationDisclosure: "public", placesTakenOutside: 3 } } });
        expect(await updateEventAction("host", EVENT_ID, form({ capacity: "20", placesTakenOutside: "-1" }))).toEqual({
            success: false,
            message: PLACES_TAKEN_OUTSIDE_INVALID,
        });
        expect(storedOutside()).toBe(3);
    });

    test("the capacity can't be lower than confirmed + outside", async () => {
        seed({ capacity: 10, guestConfirmations: withConfirmed(2) });
        expect(await updateEventAction("host", EVENT_ID, form({ capacity: "3", placesTakenOutside: "2" }))).toEqual({
            success: false,
            message:
                "2 guests are confirmed and 2 places are taken outside Peerify, so the capacity can't be lower than 4.",
        });
        expect(storedCapacity()).toBe(10);
        expect(storedOutside()).toBeUndefined();
        expect(
            (await updateEventAction("host", EVENT_ID, form({ capacity: "4", placesTakenOutside: "2" }))).success,
        ).toBe(true);
        expect(storedCapacity()).toBe(4);
        expect(storedOutside()).toBe(2);
    });

    test("raising the outside places past what's left is refused; up to it is fine", async () => {
        seed({ capacity: 5, guestConfirmations: withConfirmed(2) });
        expect(await updateEventAction("host", EVENT_ID, form({ capacity: "5", placesTakenOutside: "4" }))).toEqual({
            success: false,
            message:
                "2 guests are confirmed and 4 places are taken outside Peerify, so the capacity can't be lower than 6.",
        });
        expect(
            (await updateEventAction("host", EVENT_ID, form({ capacity: "5", placesTakenOutside: "3" }))).success,
        ).toBe(true);
        expect(storedOutside()).toBe(3);
    });

    test("clearing the capacity clears the outside places", async () => {
        seed({ capacity: 10, metadata: { peerify: { locationDisclosure: "public", placesTakenOutside: 3 } } });
        // The form sends no capacity (empty); a stray outside value is ignored.
        expect((await updateEventAction("host", EVENT_ID, form({ placesTakenOutside: "3" }))).success).toBe(true);
        expect(storedOutside()).toBeUndefined();
    });

    test("works on an older event stored with metadata: null", async () => {
        seed({ capacity: 10, metadata: null });
        expect(
            (await updateEventAction("host", EVENT_ID, form({ capacity: "10", placesTakenOutside: "2" }))).success,
        ).toBe(true);
        expect(storedOutside()).toBe(2);
    });

    test("the capacity write carries confirmed + outside (a confirm landing after the first check)", async () => {
        seed({ capacity: 5, guestConfirmations: withConfirmed(1) });
        const events = fakeDb.col("Events");
        const realFindOne = events.findOne.bind(events);
        // The early check reads one confirmed guest; by the time of the write there are three.
        let reads = 0;
        (events as any).findOne = async (...args: any[]) => {
            const doc = await realFindOne(...(args as [any]));
            if (doc?.guestConfirmations && ++reads === 1) {
                events.docs[0].guestConfirmations = withConfirmed(3);
                return { ...doc, guestConfirmations: withConfirmed(1) };
            }
            return doc;
        };
        const result = await updateEventAction("host", EVENT_ID, form({ capacity: "5", placesTakenOutside: "3" }));
        (events as any).findOne = realFindOne;
        expect(result).toEqual({
            success: false,
            message:
                "3 guests are confirmed and 3 places are taken outside Peerify, so the capacity can't be lower than 6.",
        });
        expect(storedCapacity()).toBe(5);
        expect(storedOutside()).toBeUndefined();
    });
});
