// Run: IS_BUILD=true bun test src/lib/data/act-filter-search.test.ts
// Act format / What you do filters through the server search (2026-10-22): searchDiscoverableCircles
// (Explore search, and Discover through getDiscoverResultsAction) narrows artist profiles only,
// in the Mongo query itself, so the candidate limit can't cut a matching artist. The database is
// in-memory fakes (testing/fake-db.ts); the session is anonymous.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => undefined,
}));

// The fake collections have no distinct(); Discover's has-tracks flag isn't under test here.
const realTrack = await import("./track");
mock.module("./track", () => ({ ...realTrack, getCircleIdsWithTracks: async () => new Set<string>() }));

const { searchDiscoverableCircles } = await import("./search");
const { getDiscoverResultsAction } = await import("@/components/modules/discover/actions");

const artist = (id: string, identityType: string, artistProfile: Record<string, unknown> = {}) => ({
    _id: id,
    did: `did:test:${id}`,
    handle: id,
    name: id,
    circleType: "circle",
    publishStatus: "published",
    metadata: { peerify: { managedIdentity: true, identityType, artistProfile } },
});
const venue = (id: string) => ({
    _id: id,
    did: `did:test:${id}`,
    handle: id,
    name: id,
    circleType: "circle",
    publishStatus: "published",
    metadata: { peerify: { managedIdentity: true, identityType: "venue", venueProfile: {} } },
});

const ids = (circles: { _id?: unknown }[]) => circles.map((c) => String(c._id)).sort();

beforeEach(() => {
    fakeDb.reset({
        Circles: [
            artist("solo-default", "artist"),
            artist("band-default", "band"),
            artist("duo-teacher", "artist", { actFormat: "duo", actOffers: ["lessons_workshops", "covers_tributes"] }),
            artist("covers-band", "band", { actOffers: ["covers_tributes"] }),
            artist("draft-duo", "artist", { actFormat: "duo" }),
            venue("venue-1"),
        ].map((c) => (c._id === "draft-duo" ? { ...c, publishStatus: "draft" } : c)),
    });
});

describe("searchDiscoverableCircles with act filters", () => {
    test("no act filter: everything published", async () => {
        expect(ids(await searchDiscoverableCircles({}))).toEqual(
            ["band-default", "covers-band", "duo-teacher", "solo-default", "venue-1"].sort(),
        );
    });

    test("act format narrows artists, venues stay", async () => {
        expect(ids(await searchDiscoverableCircles({ actFilters: { actFormats: ["band"] } }))).toEqual(
            ["band-default", "covers-band", "venue-1"].sort(),
        );
        expect(ids(await searchDiscoverableCircles({ actFilters: { actFormats: ["solo", "duo"] } }))).toEqual(
            ["duo-teacher", "solo-default", "venue-1"].sort(),
        );
    });

    test("What you do narrows artists, any-of; both filters must match", async () => {
        expect(
            ids(await searchDiscoverableCircles({ actFilters: { actOffers: ["covers_tributes", "lessons_workshops"] } })),
        ).toEqual(["covers-band", "duo-teacher", "venue-1"].sort());
        expect(
            ids(
                await searchDiscoverableCircles({
                    actFilters: { actFormats: ["band"], actOffers: ["lessons_workshops"] },
                }),
            ),
        ).toEqual(["venue-1"]);
    });

    test("filtered in the query: a match behind 130 non-matching artists is still found", async () => {
        fakeDb.reset({
            Circles: [
                ...Array.from({ length: 130 }, (_, i) => artist(`filler-${i}`, "band")),
                artist("last-duo", "artist", { actFormat: "duo" }),
            ],
        });
        const results = await searchDiscoverableCircles({ limit: 20, actFilters: { actFormats: ["duo"] } });
        expect(ids(results)).toEqual(["last-duo"]);
    });

    test("the result carries the act fields to an anonymous viewer", async () => {
        const [result] = await searchDiscoverableCircles({ actFilters: { actOffers: ["lessons_workshops"] } });
        const artistProfile = (result.metadata as any).peerify.artistProfile;
        expect(artistProfile.actFormat).toBe("duo");
        expect(artistProfile.actOffers).toEqual(["lessons_workshops", "covers_tributes"]);
    });
});

describe("getDiscoverResultsAction", () => {
    test("passes act filters through; artists only", async () => {
        const results = await getDiscoverResultsAction({
            query: "",
            selectedCategories: ["users"],
            primaryGenres: [],
            actFormats: ["duo"],
            actOffers: ["covers_tributes"],
        });
        expect(ids(results.artists)).toEqual(["duo-teacher"]);
    });

    test("without act filters, unchanged", async () => {
        const results = await getDiscoverResultsAction({ query: "", selectedCategories: ["users"], primaryGenres: [] });
        expect(ids(results.artists)).toEqual(["band-default", "covers-band", "duo-teacher", "solo-default"].sort());
    });
});
