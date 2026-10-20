// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/attendees.test.ts"
// Round 3, item 3 (2026-10-20): event attendee lists go only to the event's managers in full; any
// other viewer gets just their own RSVP. Identity fields only (name, handle, picture), and only for
// an event of the circle in the URL. In-memory fakes, session and permissions stubbed. The tests
// fail on the code before this change: every member got every attendee's full profile.

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
const MEMBER = "did:test:member";

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

const { getAttendeesAction, getAttendeesWithDetailsAction } = await import("./actions");

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
            { _id: new ObjectId(OTHER_ID), did: "did:test:other", handle: "other", name: "Other", circleType: "circle" },
            user(AUTHOR, "author"),
            user(GUEST_A, "guest-a"),
            user(GUEST_B, "guest-b"),
            user(MEMBER, "member"),
        ],
        EventRsvps: [
            { eventId: EVENT_ID, userDid: GUEST_A, status: "going", isPublic: true },
            { eventId: EVENT_ID, userDid: GUEST_B, status: "going", isPublic: true, message: "See you" },
        ],
    });
    fakeDb.setAggregateResult("Events", [event()]);
});

const dids = (list: { did?: string }[]) => list.map((u) => u.did).sort();
const leaksProfile = (output: unknown) => {
    const text = JSON.stringify(output) ?? "";
    return text.includes(STREET) || text.includes(EMAIL_HINT) || text.includes("secret-interest");
};

describe("event attendee lists", () => {
    test("a member who isn't attending and doesn't manage the event sees nobody", async () => {
        sessionDid = MEMBER;
        expect((await getAttendeesAction("host", EVENT_ID)).users).toEqual([]);
        expect((await getAttendeesWithDetailsAction("host", EVENT_ID)).attendees).toEqual([]);
    });

    test("an attendee sees only their own entry", async () => {
        sessionDid = GUEST_A;
        expect(dids((await getAttendeesAction("host", EVENT_ID)).users)).toEqual([GUEST_A]);
        const details = (await getAttendeesWithDetailsAction("host", EVENT_ID)).attendees;
        expect(dids(details.map((a) => a.user))).toEqual([GUEST_A]);
    });

    test("the event's author sees everyone, with identity fields only", async () => {
        sessionDid = AUTHOR;
        const users = (await getAttendeesAction("host", EVENT_ID)).users;
        expect(dids(users)).toEqual([GUEST_A, GUEST_B].sort());
        expect(leaksProfile(users)).toBe(false);
        const details = (await getAttendeesWithDetailsAction("host", EVENT_ID)).attendees;
        expect(details.find((a) => a.user.did === GUEST_B)?.message).toBe("See you");
        expect(leaksProfile(details)).toBe(false);
        expect(typeof details[0].user.name).toBe("string");
    });

    test("an event of another circle gives no list through this circle's URL", async () => {
        fakeDb.setAggregateResult("Events", [event(OTHER_ID)]);
        sessionDid = AUTHOR;
        expect((await getAttendeesAction("host", EVENT_ID)).users).toEqual([]);
        expect((await getAttendeesWithDetailsAction("host", EVENT_ID)).attendees).toEqual([]);
    });
});
