// Run: IS_BUILD=true bun test src/components/modules/discover/discover-city.test.tsx
// Discover shows the artist's city instead of the distance (Tim, 2026-11-24), at the precision
// the artist chose for their location and never more precise: the city at City or finer, the
// region at Region, the country at Country, never a street or coordinates. The order stays as it
// was (signed in: popularity, recentness and proximity; signed out: the search score), and the
// payload no longer carries the distance, so the expanded card's badge can't show it either.
// The database is in-memory fakes (testing/fake-db.ts).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore, Provider } from "jotai";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));
const realTrack = await import("@/lib/data/track");
mock.module("@/lib/data/track", () => ({ ...realTrack, getCircleIdsWithTracks: async () => new Set<string>() }));
const realEvent = await import("@/lib/data/event");
mock.module("@/lib/data/event", () => ({ ...realEvent, getOpenEventsForMap: async () => [] }));
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
    usePathname: () => "/discover",
    useSearchParams: () => new URLSearchParams(),
}));

const { getPublicPlaceLabel } = await import("@/lib/utils");
const { getDiscoverResultsAction } = await import("./actions");
const { searchDiscoverableCircles } = await import("@/lib/data/search");
const { getMetricsForCircles } = await import("@/lib/data/circle");
const { default: ArtistCard } = await import("./artist-card");
const { userAtom } = await import("@/lib/data/atoms");

const CAPE_TOWN = { lng: 18.42, lat: -33.92 };
const place = (precision: number) => ({
    precision,
    country: "South Africa",
    region: "Western Cape",
    city: "Cape Town",
    street: "CANARY Street 1",
    lngLat: CAPE_TOWN,
});

describe("the label, at the precision the artist chose", () => {
    test("Exact (confirmed), Street and City: the city", () => {
        expect(getPublicPlaceLabel({ ...place(4), exactConfirmedAt: new Date() })).toBe("Cape Town");
        expect(getPublicPlaceLabel(place(4))).toBe("Cape Town");
        expect(getPublicPlaceLabel(place(3))).toBe("Cape Town");
        expect(getPublicPlaceLabel(place(2))).toBe("Cape Town");
    });

    test("Region: the region, never the city", () => {
        expect(getPublicPlaceLabel(place(1))).toBe("Western Cape");
    });

    test("Country: the country, never the region or city", () => {
        expect(getPublicPlaceLabel(place(0))).toBe("South Africa");
    });

    test("City chosen but no city stored: the region, then the country", () => {
        expect(getPublicPlaceLabel({ precision: 2, region: "Western Cape", country: "South Africa" })).toBe(
            "Western Cape",
        );
        expect(getPublicPlaceLabel({ precision: 2, country: "South Africa" })).toBe("South Africa");
    });

    test("no precision stored: the country at most", () => {
        expect(getPublicPlaceLabel({ city: "Cape Town", country: "South Africa" } as any)).toBe("South Africa");
    });

    test("nothing to show: no label", () => {
        expect(getPublicPlaceLabel(undefined)).toBeUndefined();
        expect(getPublicPlaceLabel({ precision: 2, lngLat: CAPE_TOWN })).toBeUndefined();
    });
});

const artist = (id: string, precision: number, extra: Record<string, unknown> = {}) => ({
    _id: id,
    did: `did:test:${id}`,
    handle: id,
    name: `Artist ${id}`,
    circleType: "circle",
    publishStatus: "published",
    primaryGenres: ["jazz"],
    location: place(precision),
    metadata: { peerify: { managedIdentity: true, identityType: "band", artistProfile: { actFormat: "band" } } },
    ...extra,
});

describe("the card", () => {
    const render = (location: unknown) => {
        const store = createStore();
        store.set(userAtom, {
            did: "did:test:viewer",
            location: { precision: 2, lngLat: { lng: 18.5, lat: -33.9 } },
        } as any);
        return renderToStaticMarkup(
            <Provider store={store}>
                <ArtistCard artist={{ ...artist("card", 2), location } as any} />
            </Provider>,
        );
    };

    test("genre and city, no distance", () => {
        const html = render(place(2));
        expect(html).toContain("jazz · Cape Town");
        expect(html).not.toContain("km away");
    });

    test("never more precise than the artist set", () => {
        const html = render(place(1));
        expect(html).toContain("Western Cape");
        expect(html).not.toContain("Cape Town");
        expect(html).not.toContain("CANARY");
    });
});

describe("the results", () => {
    const VIEWER = "did:test:viewer";
    beforeEach(() => {
        sessionDid = undefined;
        fakeDb.reset({
            Circles: [
                // Exact and confirmed, so the payload keeps their points and a distance can be worked out.
                artist("near-old", 4, {
                    members: 1,
                    createdAt: new Date("2024-01-01"),
                    location: { ...place(4), exactConfirmedAt: new Date("2026-01-01") },
                }),
                artist("far-popular", 4, {
                    members: 400,
                    createdAt: new Date(),
                    location: {
                        ...place(4),
                        exactConfirmedAt: new Date("2026-01-01"),
                        lngLat: { lng: -74.0, lat: 40.7 },
                    },
                }),
                artist("region-only", 1, { members: 20, createdAt: new Date("2025-06-01") }),
                {
                    _id: VIEWER,
                    did: VIEWER,
                    handle: "viewer",
                    circleType: "user",
                    publishStatus: "published",
                    location: { precision: 2, city: "Cape Town", lngLat: { lng: 18.5, lat: -33.9 } },
                },
            ],
            Members: [],
            UserRelationships: [],
        });
    });

    const input = { query: "", selectedCategories: [], primaryGenres: [] };

    test("signed in: no distance or proximity in the payload", async () => {
        sessionDid = VIEWER;
        const before = await getMetricsForCircles(
            await searchDiscoverableCircles({ query: "", limit: 40, circleTypes: ["circle"], viewerDid: VIEWER }),
            VIEWER,
        );
        // The setup works: before this change, the exact-location artists carried a distance.
        expect(before.filter((a) => a.metrics?.distance !== undefined).length).toBe(2);
        const { artists } = await getDiscoverResultsAction(input);
        expect(artists.length).toBe(3);
        for (const a of artists) {
            expect(a.metrics?.distance).toBeUndefined();
            expect(a.metrics?.proximity).toBeUndefined();
        }
    });

    test("signed in: the same order as before", async () => {
        sessionDid = VIEWER;
        const expected = await getMetricsForCircles(
            await searchDiscoverableCircles({ query: "", limit: 40, circleTypes: ["circle"], viewerDid: VIEWER }),
            VIEWER,
        );
        const { artists } = await getDiscoverResultsAction(input);
        expect(artists.map((a) => a._id)).toEqual(expected.map((a) => a._id));
    });

    test("the region-only artist's location reaches the card without its city", async () => {
        const { artists } = await getDiscoverResultsAction(input);
        const regionOnly: any = artists.find((a) => a._id === "region-only");
        expect(regionOnly?.location?.city).toBeUndefined();
        expect(getPublicPlaceLabel(regionOnly?.location)).toBe("Western Cape");
    });
});
