// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/location-leaks.test.ts"
// Server-action and ICS-route half of the 2026-10-19 location leak fixes (the data layer is in
// src/lib/data/location-leaks.test.ts). The database is in-memory fakes (testing/fake-db.ts), and
// the session and permission checks are stubbed, so nothing real is touched. Each test fails on the
// code before the fix: raw street/coordinates came back, or a non-public event was served.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
let publicEvents = false; // the host circle's events.view includes "everyone"
const members = new Set<string>(); // events.view for signed-in viewers
const moderators = new Set<string>(); // events.moderate
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, _circleId: string, feature: unknown) => {
        if (feature === features.events.view) return did ? members.has(did) : publicEvents;
        if (feature === features.events.moderate) return !!did && moderators.has(did);
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getCirclesBySearchQueryAction, searchArtistCirclesAction, getEventArtistsAction } = await import("./actions");
const { GET: eventIcs } = await import("./[eventId]/ics/route");
const { GET: feedIcs } = await import("./ics/route");

const STREET = "Teststraat 1";
const EXACT = { lng: 18.071234, lat: 59.325678 };
const location = () => ({
    precision: 4,
    country: "Sweden",
    region: "Stockholm",
    city: "Stockholm",
    street: STREET,
    lngLat: { ...EXACT },
});
const leaksLocation = (output: unknown) => {
    const text = typeof output === "string" ? output : (JSON.stringify(output) ?? "");
    return text.includes(STREET) || text.includes(String(EXACT.lng)) || text.includes(String(EXACT.lat));
};

const HOST_ID = "64a000000000000000000001";
const ARTIST_ID = "64a000000000000000000002";
const EVENT_ID = "64a0000000000000000000e1";
const PRIVATE_EVENT_ID = "64a0000000000000000000e2";
const AUTHOR = "did:test:author";
const MEMBER = "did:test:member";
const MODERATOR = "did:test:moderator";
const ARTIST_OWNER = "did:test:artist";

const future = (days: number) => new Date(Date.now() + days * 86_400_000);
const event = (id: string, extra: Record<string, unknown> = {}) => ({
    _id: id,
    circleId: HOST_ID,
    title: "House show",
    stage: "open",
    createdBy: AUTHOR,
    startAt: future(3),
    endAt: future(4),
    location: location(),
    metadata: { peerify: { locationDisclosure: "approximate", privateLocationNote: "Door code 1234" } },
    additionalArtistCircleIds: [ARTIST_ID],
    ...extra,
});

beforeEach(() => {
    sessionDid = undefined;
    publicEvents = false;
    members.clear();
    moderators.clear();
    members.add(MEMBER).add(AUTHOR).add(MODERATOR);
    moderators.add(MODERATOR);
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(HOST_ID),
                did: "did:test:host",
                handle: "host",
                name: "Host",
                circleType: "circle",
                location: location(),
            },
            {
                _id: new ObjectId(ARTIST_ID),
                did: ARTIST_OWNER,
                handle: "band",
                name: "The Band",
                circleType: "circle",
                location: location(),
                metadata: { peerify: { identityType: "band", managedIdentity: true } },
            },
        ],
        // Stored like the driver returns them (ObjectId _id); the aggregate result is already shaped.
        Events: [
            event(EVENT_ID, { _id: new ObjectId(EVENT_ID) }),
            event(PRIVATE_EVENT_ID, { _id: new ObjectId(PRIVATE_EVENT_ID), title: "Secret", visibility: "private" }),
        ],
    });
    fakeDb.setAggregateResult("Events", [event(EVENT_ID)]);
});

describe("circle search actions", () => {
    test('logged out, "." returns nothing', async () => {
        const { circles } = await getCirclesBySearchQueryAction(".", 25);
        expect(circles).toHaveLength(0);
    });

    test("signed in, results carry no street or exact pin", async () => {
        sessionDid = MEMBER;
        const { circles } = await getCirclesBySearchQueryAction("", 25);
        expect(circles.length).toBeGreaterThan(0);
        expect(leaksLocation(circles)).toBe(false);
    });

    test("artist search results carry no street or exact pin", async () => {
        const { circles } = await searchArtistCirclesAction("Band", 15);
        expect(circles.map((c) => c.name)).toEqual(["The Band"]);
        expect(leaksLocation(circles)).toBe(false);
    });
});

describe("getEventArtistsAction", () => {
    test("logged out, an event that isn't public returns no artists", async () => {
        const { bands } = await getEventArtistsAction("host", EVENT_ID);
        expect(bands).toHaveLength(0);
    });

    test("logged out, a public event's artists carry no street or exact pin", async () => {
        publicEvents = true;
        const { bands } = await getEventArtistsAction("host", EVENT_ID);
        expect(bands.map((b) => b.circle.name)).toEqual(["The Band"]);
        expect(leaksLocation(bands)).toBe(false);
    });

    test("the artist circle's owner still gets it unchanged", async () => {
        sessionDid = ARTIST_OWNER;
        const { bands } = await getEventArtistsAction("host", EVENT_ID);
        expect(bands[0].circle.location?.street).toBe(STREET);
    });
});

const callEventIcs = (eventId = EVENT_ID) =>
    eventIcs(new Request(`http://localhost/circles/host/events/${eventId}/ics`), {
        params: Promise.resolve({ handle: "host", eventId }),
    });
const callFeedIcs = () =>
    feedIcs(new Request("http://localhost/circles/host/events/ics"), { params: Promise.resolve({ handle: "host" }) });

describe("event ICS", () => {
    test("logged out, a circle whose events aren't public gets 404", async () => {
        expect((await callEventIcs()).status).toBe(404);
    });

    test("logged out, an approximate event has the area but no street or coordinates", async () => {
        publicEvents = true;
        const response = await callEventIcs();
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(body).toContain("Stockholm");
        expect(leaksLocation(body)).toBe(false);
        expect(response.headers.get("Cache-Control")).toContain("private");
    });

    test("logged out, a private event gets 404", async () => {
        publicEvents = true;
        expect((await callEventIcs(PRIVATE_EVENT_ID)).status).toBe(404);
    });

    test("a member without moderate rights gets the area only", async () => {
        sessionDid = MEMBER;
        expect(leaksLocation(await (await callEventIcs()).text())).toBe(false);
    });

    test("the author and moderators keep the full address", async () => {
        for (const did of [AUTHOR, MODERATOR]) {
            sessionDid = did;
            expect(await (await callEventIcs()).text()).toContain(STREET);
        }
    });
});

describe("circle events ICS feed", () => {
    test("logged out, a circle whose events aren't public gets 404", async () => {
        expect((await callFeedIcs()).status).toBe(404);
    });

    test("logged out: no street for approximate events, no private events", async () => {
        publicEvents = true;
        const body = await (await callFeedIcs()).text();
        expect(body).toContain("House show");
        expect(body).not.toContain("Secret");
        expect(leaksLocation(body)).toBe(false);
    });

    test("a moderator keeps the full address", async () => {
        sessionDid = MODERATOR;
        expect(await (await callFeedIcs()).text()).toContain(STREET);
    });
});
