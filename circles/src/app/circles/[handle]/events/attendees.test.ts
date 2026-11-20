// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/attendees.test.ts"
// Round 3, item 3 (2026-10-20): event attendee lists go only to the event's organisers in full; any
// other viewer gets just their own RSVP. Identity fields only (name, handle, picture), and only for
// an event of the circle in the URL. In-memory fakes, session and permissions stubbed. The tests
// failed on the code before that change: every member got every attendee's full profile.
// Event guests, part 1 (2026-11-20): one list, getEventGuestsAction, with Attend and Interested,
// whatever the person chose for the old "appear publicly" switch (D6), each with when they replied.
// Who the organisers are is in event-guests-organisers.test.ts.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const HOST_ID = "64d000000000000000000001";
const OTHER_ID = "64d000000000000000000002";
const EVENT_ID = "64d0000000000000000000e1";
const AUTHOR = "did:test:author";
const GUEST_A = "did:test:guest-a";
const GUEST_B = "did:test:guest-b";
const GUEST_C = "did:test:guest-c";
const GUEST_D = "did:test:guest-d";
const MEMBER = "did:test:member";
const at = (day: number) => new Date(Date.UTC(2026, 10, day, 12));

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    // Every signed-in viewer may view HOST's events; nobody moderates.
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) =>
        !!did && String(circleId) === HOST_ID && feature === features.events.view,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getEventGuestsAction } = await import("./actions");

const STREET = "Gästgatan 5";
const EMAIL_HINT = "guest-private-bio";
const user = (did: string, handle: string) => ({
    _id: new ObjectId(),
    did,
    handle,
    name: handle,
    circleType: "user",
    picture: { url: `https://img.test/${handle}.png` },
    location: { precision: 4, city: "Malmö", street: STREET, lngLat: { lng: 13.0, lat: 55.6 } },
    metadata: { peerify: { onboardingFlow: EMAIL_HINT } },
    interests: ["secret-interest"],
});
const event = (circleId = HOST_ID) => ({ _id: EVENT_ID, circleId, createdBy: AUTHOR, title: "Gig", stage: "open" });

beforeEach(() => {
    sessionDid = undefined;
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
            user(AUTHOR, "author"),
            user(GUEST_A, "guest-a"),
            user(GUEST_B, "guest-b"),
            user(GUEST_C, "guest-c"),
            user(GUEST_D, "guest-d"),
            user(MEMBER, "member"),
        ],
        EventRsvps: [
            { eventId: EVENT_ID, userDid: GUEST_A, status: "going", isPublic: true, updatedAt: at(2) },
            {
                eventId: EVENT_ID,
                userDid: GUEST_B,
                status: "going",
                isPublic: true,
                message: "See you",
                updatedAt: at(3),
            },
            { eventId: EVENT_ID, userDid: GUEST_C, status: "interested", isPublic: true, updatedAt: at(1) },
            { eventId: EVENT_ID, userDid: GUEST_D, status: "going", isPublic: false, updatedAt: at(4) },
        ],
    });
    fakeDb.setAggregateResult("Events", [event()]);
});

const dids = (list: { did?: string }[]) => list.map((u) => u.did).sort();
const leaksProfile = (output: unknown) => {
    const text = JSON.stringify(output) ?? "";
    return text.includes(STREET) || text.includes(EMAIL_HINT) || text.includes("secret-interest");
};

const guestsFor = async (did: string | undefined) => {
    sessionDid = did;
    return getEventGuestsAction("host", EVENT_ID);
};

describe("event guest list", () => {
    test("a member who isn't a guest and doesn't organise sees nobody", async () => {
        const result = await guestsFor(MEMBER);
        expect(result.canSeeGuests).toBe(false);
        expect(result.guests).toEqual([]);
    });

    test("a guest sees only their own entry, Attend or Interested", async () => {
        expect(dids((await guestsFor(GUEST_A)).guests.map((g) => g.user))).toEqual([GUEST_A]);
        const interested = (await guestsFor(GUEST_C)).guests;
        expect(interested.map((g) => [g.user.did, g.status])).toEqual([[GUEST_C, "interested"]]);
    });

    test("the event's creator sees Attend and Interested, earliest reply first, with dates and messages", async () => {
        const result = await guestsFor(AUTHOR);
        expect(result.canSeeGuests).toBe(true);
        expect(result.guests.map((g) => [g.user.did, g.status])).toEqual([
            [GUEST_C, "interested"],
            [GUEST_A, "going"],
            [GUEST_B, "going"],
            [GUEST_D, "going"],
        ]);
        expect(result.guests.find((g) => g.user.did === GUEST_B)?.message).toBe("See you");
        expect(result.guests.find((g) => g.user.did === GUEST_A)?.since).toEqual(at(2));
    });

    test("someone who said not to appear publicly is still on the organisers' list (D6)", async () => {
        expect(dids((await guestsFor(AUTHOR)).guests.map((g) => g.user))).toContain(GUEST_D);
    });

    test("identity fields only", async () => {
        const guests = (await guestsFor(AUTHOR)).guests;
        expect(leaksProfile(guests)).toBe(false);
        expect(typeof guests[0].user.name).toBe("string");
        expect(guests[0].user.picture?.url).toContain("img.test");
    });

    test("an event of another circle gives no list through this circle's URL", async () => {
        fakeDb.setAggregateResult("Events", [event(OTHER_ID)]);
        expect((await guestsFor(AUTHOR)).guests).toEqual([]);
    });

    test("signed out: nothing", async () => {
        expect(await guestsFor(undefined)).toEqual({ canSeeGuests: false, needsProfileToSeeGuests: false, guests: [] });
    });
});
