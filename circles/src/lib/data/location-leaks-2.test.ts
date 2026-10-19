// Run: IS_BUILD=true bun test src/lib/data/location-leaks-2.test.ts
// Round 2 of the 2026-10-19 location leak fixes, data layer: getCirclesByIds/getCirclesByDids are
// viewer-safe by default, and circle distances come from the location the viewer may see. The
// server actions and pages that use them are in src/app/location-leaks-2.test.ts. The database is
// in-memory fakes (testing/fake-db.ts), so nothing real is touched. The leak tests fail on the
// code before the fix: the stored street, exact pin, venue address or Crew Offers came back.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const { getCirclesByIds, getCirclesByDids, getCirclesWithMetrics, getMetricsForCircles } = await import("./circle");
const { getAuthorizedMembers } = await import("@/lib/auth/auth");
const { calculateDistance } = await import("@/lib/utils/metrics");
const { coarsenLngLat } = await import("@/lib/utils");

const STREET = "Teststraat 1";
const EXACT = { lng: 18.071234, lat: 59.325678 };
const VENUE_ADDRESS = "Hemlig gatan 9";
const OFFER = "Secret crew offer";
const PRIVATE_META = "private-onboarding-flow";
const exactLocation = () => ({
    precision: 4,
    country: "Sweden",
    region: "Stockholm",
    city: "Stockholm",
    street: STREET,
    lngLat: { ...EXACT },
});

const OWNER = "did:test:owner";
const STRANGER = "did:test:stranger";
const ADMIN = "did:test:admin";
const ARTIST_ID = "64a000000000000000000a01";
const VENUE_ID = "64a000000000000000000a02";
const STRANGER_ID = "64a000000000000000000a03";
const ADMIN_ID = "64a000000000000000000a04";

const leaks = (output: unknown) => {
    const text = JSON.stringify(output) ?? "";
    return {
        street: text.includes(STREET),
        exactPin: text.includes(String(EXACT.lng)) || text.includes(String(EXACT.lat)),
        venueAddress: text.includes(VENUE_ADDRESS),
        crewOffers: text.includes(OFFER),
        privateMetadata: text.includes(PRIVATE_META),
    };
};
const NO_LEAKS = { street: false, exactPin: false, venueAddress: false, crewOffers: false, privateMetadata: false };
const ALL_LEAKS = { street: true, exactPin: true, venueAddress: true, crewOffers: true, privateMetadata: true };

const artist = () => ({
    _id: new ObjectId(ARTIST_ID),
    did: OWNER,
    handle: "artist",
    name: "Artist",
    circleType: "user",
    publishStatus: "published",
    picture: { url: "/a.png" },
    location: exactLocation(),
    tourTeamOfferings: [{ id: "o1", title: OFFER }],
    metadata: { peerify: { intent: "artist", onboardingFlow: PRIVATE_META } },
});
const venue = () => ({
    _id: new ObjectId(VENUE_ID),
    did: "did:test:venue",
    createdBy: OWNER,
    handle: "venue",
    name: "Venue",
    circleType: "circle",
    publishStatus: "published",
    location: exactLocation(),
    metadata: {
        peerify: {
            identityType: "venue",
            managedIdentity: true,
            venueProfile: { address: VENUE_ADDRESS, addressVisibility: "private" },
        },
    },
});
const seed = () =>
    fakeDb.reset({
        Circles: [
            artist(),
            venue(),
            {
                _id: new ObjectId(STRANGER_ID),
                did: STRANGER,
                handle: "stranger",
                name: "Stranger",
                circleType: "user",
                location: { precision: 4, city: "Uppsala", lngLat: { lng: 17.6389, lat: 59.8586 } },
            },
            {
                _id: new ObjectId(ADMIN_ID),
                did: ADMIN,
                handle: "admin",
                name: "Admin",
                circleType: "user",
                isAdmin: true,
            },
        ],
    });

beforeEach(seed);

describe("getCirclesByIds / getCirclesByDids: safe by default", () => {
    test("a stranger gets no street, exact pin, venue address, Crew Offers or private metadata", async () => {
        const byIds = await getCirclesByIds([ARTIST_ID, VENUE_ID], { viewerDid: STRANGER });
        const byDids = await getCirclesByDids([OWNER, "did:test:venue"], { viewerDid: STRANGER });
        expect(byIds).toHaveLength(2);
        expect(byDids).toHaveLength(2);
        expect(leaks(byIds)).toEqual(NO_LEAKS);
        expect(leaks(byDids)).toEqual(NO_LEAKS);
    });

    test("no viewer: the same anonymous shape", async () => {
        expect(leaks(await getCirclesByIds([ARTIST_ID, VENUE_ID]))).toEqual(NO_LEAKS);
        expect(leaks(await getCirclesByDids([OWNER, "did:test:venue"]))).toEqual(NO_LEAKS);
    });

    test("an unconfirmed exact location keeps the city and the public grid pin", async () => {
        const [circle] = await getCirclesByDids([OWNER], { viewerDid: STRANGER });
        expect(circle.name).toBe("Artist");
        expect(circle.location?.city).toBe("Stockholm");
        expect(circle.location?.lngLat).toEqual(coarsenLngLat(EXACT));
        expect(circle.metadata?.peerify?.intent).toBe("artist");
    });

    test("a non-public venue: city level, no pin", async () => {
        const [circle] = await getCirclesByIds([VENUE_ID], { viewerDid: STRANGER });
        expect(circle.location?.city).toBe("Stockholm");
        expect(circle.location?.lngLat).toBeUndefined();
    });

    test("the owner (did or createdBy) gets the whole document", async () => {
        const circles = await getCirclesByIds([ARTIST_ID, VENUE_ID], { viewerDid: OWNER });
        expect(leaks(circles)).toEqual(ALL_LEAKS);
        expect(circles.every((c) => typeof c._id === "string")).toBe(true);
    });

    test("a platform admin gets the whole document", async () => {
        expect(leaks(await getCirclesByDids([OWNER, "did:test:venue"], { viewerDid: ADMIN }))).toEqual(ALL_LEAKS);
    });

    test("includePrivate: the stored location and metadata, but still no Crew Offers for others", async () => {
        const circles = await getCirclesByIds([ARTIST_ID, VENUE_ID], { viewerDid: STRANGER, includePrivate: true });
        expect(leaks(circles)).toEqual({ ...ALL_LEAKS, crewOffers: false });
    });

    test("identityOnly: name, handle and picture, nothing else", async () => {
        const [circle] = await getCirclesByDids([OWNER], { identityOnly: true });
        expect(circle).toEqual({
            _id: ARTIST_ID,
            did: OWNER,
            handle: "artist",
            name: "Artist",
            picture: { url: "/a.png" },
            circleType: "user",
            metadata: { peerify: { intent: "artist" } },
        });
    });

    test("getAuthorizedMembers (notification recipients) still finds the members, without their locations", async () => {
        fakeDb.reset({ Circles: [artist(), venue()] });
        fakeDb.setAggregateResult("Members", [
            { _id: "m1", circleId: VENUE_ID, userDid: OWNER, userGroups: ["admins"] },
            { _id: "m2", circleId: VENUE_ID, userDid: STRANGER, userGroups: ["members"] },
        ]);
        const venueCircle = { ...venue(), _id: VENUE_ID } as any;
        const members = await getAuthorizedMembers(venueCircle, features.general.manage_membership_requests);
        expect(members.map((m) => m.did)).toEqual([OWNER]);
        expect(leaks(members)).toEqual(NO_LEAKS);
    });
});

describe("circle distances come from the location the viewer may see", () => {
    const strangerAt = { lng: 17.6389, lat: 59.8586 };
    const gridDistance = calculateDistance(strangerAt, coarsenLngLat(EXACT));
    const realDistance = calculateDistance(strangerAt, EXACT);

    test("the grid and the real point really are different distances (guards the tests below)", () => {
        expect(gridDistance).not.toBeUndefined();
        expect(Math.abs((gridDistance ?? 0) - (realDistance ?? 0))).toBeGreaterThan(0.1);
    });

    test("getCirclesWithMetrics (/circles directory): distance and proximity to the grid pin", async () => {
        fakeDb.reset({
            Circles: [
                {
                    ...venue(),
                    metadata: { peerify: { identityType: "venue", venueProfile: { addressVisibility: "public" } } },
                },
                {
                    _id: new ObjectId(STRANGER_ID),
                    did: STRANGER,
                    circleType: "user",
                    location: { precision: 4, lngLat: strangerAt },
                },
            ],
        });
        const [circle] = await getCirclesWithMetrics(STRANGER, undefined, "near", "circle");
        expect(circle.name).toBe("Venue");
        expect(circle.metrics?.distance).toBe(gridDistance);
        expect(circle.metrics?.proximity).toBe(1 - gridDistance! / 20000);
        expect(leaks(circle)).toEqual(NO_LEAKS);
    });

    test("getCirclesWithMetrics: no visible pin, no distance", async () => {
        const [circle] = await getCirclesWithMetrics(STRANGER, undefined, "near", "circle");
        expect(circle.name).toBe("Venue"); // addressVisibility "private": city level
        expect(circle.metrics?.distance).toBeUndefined();
        expect(circle.metrics?.proximity).toBeUndefined();
    });

    test("getCirclesWithMetrics: a platform admin still gets the real distance", async () => {
        fakeDb.reset({
            Circles: [
                venue(),
                {
                    _id: new ObjectId(ADMIN_ID),
                    did: ADMIN,
                    circleType: "user",
                    isAdmin: true,
                    location: { lngLat: strangerAt },
                },
            ],
        });
        const [circle] = await getCirclesWithMetrics(ADMIN, undefined, "near", "circle");
        expect(circle.metrics?.distance).toBe(realDistance);
    });

    test("following tab (getCirclesByIds + getMetricsForCircles): distance to the grid pin", async () => {
        const circles = await getCirclesByIds([ARTIST_ID], { viewerDid: STRANGER });
        const [circle] = await getMetricsForCircles(circles, STRANGER, "near");
        expect(circle.metrics?.distance).toBe(gridDistance);
    });
});
