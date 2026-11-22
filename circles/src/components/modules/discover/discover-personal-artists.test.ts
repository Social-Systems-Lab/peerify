// Run: IS_BUILD=true bun test src/components/modules/discover/discover-personal-artists.test.ts
// Discover lists artist circles only (Tim, 2026-11-22). A personal profile (circleType "user")
// marked as an artist is never listed, and its "What you do" values never fill the filter row:
// its page is limited for strangers, and artists who want a public page use an artist circle.
// Checks the action's payload for a signed-out visitor, a signed-in stranger and a superadmin.
// The database is in-memory fakes (testing/fake-db.ts).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));

// Not under test here: the fakes have no distinct() for tracks, and events come from aggregations.
const realTrack = await import("@/lib/data/track");
mock.module("@/lib/data/track", () => ({ ...realTrack, getCircleIdsWithTracks: async () => new Set<string>() }));
const realEvent = await import("@/lib/data/event");
mock.module("@/lib/data/event", () => ({ ...realEvent, getOpenEventsForMap: async () => [] }));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({ ...realCircle, getMetricsForCircles: async () => undefined }));

const { getDiscoverResultsAction } = await import("./actions");

const STRANGER = "did:test:stranger";
const SUPERADMIN = "did:test:superadmin";

const personalArtist = () => ({
    _id: "personal-artist",
    did: "did:test:personal-artist",
    handle: "canary-personal-artist",
    name: "Canary Personal Artist",
    circleType: "user",
    publishStatus: "published",
    searchable: true,
    mapVisible: true,
    description: "CANARY solo artist on a personal account",
    metadata: { peerify: { intent: "artist", artistProfile: { actFormat: "solo", actOffers: ["lessons_workshops"] } } },
});
const band = () => ({
    _id: "band",
    did: "did:test:band",
    handle: "band",
    name: "Band",
    circleType: "circle",
    publishStatus: "published",
    metadata: {
        peerify: {
            managedIdentity: true,
            identityType: "band",
            artistProfile: { actFormat: "band", actOffers: ["dj_sets"] },
        },
    },
});
const viewer = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: did,
    did,
    handle: did.split(":").pop(),
    name: did,
    circleType: "user",
    publishStatus: "published",
    ...extra,
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [personalArtist(), band(), viewer(STRANGER), viewer(SUPERADMIN, { isAdmin: true })],
    });
});

const discover = (query = "") => getDiscoverResultsAction({ query, selectedCategories: ["users"], primaryGenres: [] });

describe("Discover: personal profiles marked as artists are never listed", () => {
    for (const [who, did] of [
        ["signed out", undefined],
        ["a signed-in stranger", STRANGER],
        ["a superadmin", SUPERADMIN],
    ] as const) {
        test(`${who}: artist circles only, nothing from the personal profile in the payload`, async () => {
            sessionDid = did;
            for (const query of ["", "canary"]) {
                const results = await discover(query);
                expect(results.artists.map((a) => a.handle)).toEqual(query ? [] : ["band"]);
                const payload = JSON.stringify(results);
                expect(payload).not.toContain("CANARY");
                expect(payload).not.toContain("canary-personal-artist");
                expect(payload).not.toContain("personal-artist");
            }
        });

        test(`${who}: "What you do" values come from artist circles only`, async () => {
            sessionDid = did;
            expect((await discover()).availableActOffers).toEqual(["dj_sets"]);
        });
    }
});
