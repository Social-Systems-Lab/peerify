// Run: IS_BUILD=true bun test src/lib/data/location-leaks.test.ts
// Data-layer half of the 2026-10-19 location leak fixes (the actions and ICS routes are in
// src/app/circles/[handle]/events/location-leaks.test.ts). The database is in-memory fakes
// (testing/fake-db.ts) and the session/permission checks are stubbed, so nothing real is touched.
// Each test fails on the code before the fix: raw street/coordinates/private notes came back.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => undefined,
    // Events open to everyone in every circle; nothing else is granted.
    isAuthorized: async (_did: string | undefined, _circleId: string, feature: { handle?: string }) =>
        feature?.handle === "view",
}));

const { getCirclesBySearchQuery, getOfferMapPins } = await import("./circle");
const { getOpenEventsForList } = await import("./event");

const STREET = "Teststraat 1";
const EXACT = { lng: 18.071234, lat: 59.325678 };
const exactLocation = (confirmed = false) => ({
    precision: 4,
    country: "Sweden",
    region: "Stockholm",
    city: "Stockholm",
    street: STREET,
    lngLat: { ...EXACT },
    ...(confirmed ? { exactConfirmedAt: new Date("2026-10-01T00:00:00Z") } : {}),
});
const VENUE_ADDRESS = "Hemlig gatan 9";
const OWNER = "did:test:owner";
const STRANGER = "did:test:stranger";
const ADMIN = "did:test:admin";

const leaks = (output: unknown) => {
    const text = JSON.stringify(output) ?? "";
    return {
        street: text.includes(STREET),
        lng: text.includes(String(EXACT.lng)),
        lat: text.includes(String(EXACT.lat)),
        venueAddress: text.includes(VENUE_ADDRESS),
    };
};
const NO_LEAKS = { street: false, lng: false, lat: false, venueAddress: false };

const circle = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    _id: id,
    did: `did:test:${id}`,
    handle: id,
    name,
    circleType: "circle",
    location: exactLocation(),
    ...extra,
});

describe("getCirclesBySearchQuery", () => {
    beforeEach(() => {
        fakeDb.reset({
            Circles: [
                circle("c1", "Studio A"),
                circle("c2", "Club B", {
                    metadata: {
                        peerify: {
                            identityType: "venue",
                            managedIdentity: true,
                            venueProfile: { address: VENUE_ADDRESS },
                        },
                    },
                }),
                circle("c3", "Owner draft", { publishStatus: "draft", did: OWNER, createdBy: OWNER }),
                { _id: "u-admin", did: ADMIN, circleType: "user", name: "Admin", isAdmin: true },
            ],
        });
    });

    test('"." is matched literally, not as "any character"', async () => {
        const results = await getCirclesBySearchQuery(".", 25, undefined, STRANGER);
        expect(results).toHaveLength(0);
    });

    test("a stranger gets no street, exact pin or venue address", async () => {
        const results = await getCirclesBySearchQuery("", 25, undefined, STRANGER);
        expect(results.map((c) => c.name).sort()).toEqual(["Admin", "Club B", "Studio A"]);
        expect(leaks(results)).toEqual(NO_LEAKS);
    });

    test("a draft only comes back to its owner, unchanged", async () => {
        expect((await getCirclesBySearchQuery("draft", 25, undefined, STRANGER)).length).toBe(0);
        const own = await getCirclesBySearchQuery("draft", 25, undefined, OWNER);
        expect(own).toHaveLength(1);
        expect(own[0].location?.street).toBe(STREET);
    });

    test("platform admins keep the full documents, drafts included", async () => {
        const results = await getCirclesBySearchQuery("", 25, undefined, ADMIN);
        expect(results.map((c) => c.name).sort()).toEqual(["Admin", "Club B", "Owner draft", "Studio A"]);
        expect(leaks(results).street).toBe(true);
        expect(leaks(results).venueAddress).toBe(true);
    });
});

describe("getOpenEventsForList", () => {
    beforeEach(() => fakeDb.reset());

    test("an approximate event has no street, lngLat or privateLocationNote", async () => {
        fakeDb.setAggregateResult("Events", [
            {
                _id: "e1",
                title: "House show",
                circleId: "c1",
                stage: "open",
                location: exactLocation(),
                metadata: { peerify: { locationDisclosure: "approximate", privateLocationNote: "Door code 1234" } },
            },
        ]);
        const events = await getOpenEventsForList("");
        expect(events).toHaveLength(1);
        expect(events[0].location?.street).toBeUndefined();
        expect(events[0].location?.lngLat).toBeUndefined();
        expect(events[0].location?.city).toBe("Stockholm");
        expect(JSON.stringify(events)).not.toContain("Door code");
    });

    test("a public event keeps its address", async () => {
        fakeDb.setAggregateResult("Events", [
            {
                _id: "e2",
                title: "Gig",
                circleId: "c1",
                stage: "open",
                location: exactLocation(),
                metadata: { peerify: {} },
            },
        ]);
        const events = await getOpenEventsForList("");
        expect(events[0].location?.street).toBe(STREET);
    });
});

describe("getOfferMapPins", () => {
    const venue = (addressVisibility?: string) =>
        circle("v1", "Venue", {
            location: exactLocation(true),
            offersVisible: true,
            tourTeamOfferings: [{ id: "o1", type: "accommodation" }],
            metadata: {
                peerify: { identityType: "venue", managedIdentity: true, venueProfile: { addressVisibility } },
            },
        });

    test("a venue with a private or city-area address gets no exact pin or street, even if confirmed", async () => {
        for (const visibility of ["private", "city_area", undefined]) {
            fakeDb.reset({ Circles: [venue(visibility)] });
            const pins = await getOfferMapPins();
            expect(pins).toHaveLength(1);
            expect(leaks(pins)).toEqual(NO_LEAKS);
            expect(pins[0].location?.lngLat).toEqual({ lng: 18.05, lat: 59.35 });
        }
    });

    test("a venue with a public address keeps its confirmed exact pin", async () => {
        fakeDb.reset({ Circles: [venue("public")] });
        const pins = await getOfferMapPins();
        expect(pins[0].location?.lngLat).toEqual(EXACT);
    });
});
