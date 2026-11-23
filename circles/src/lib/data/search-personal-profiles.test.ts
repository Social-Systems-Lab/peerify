// Run: IS_BUILD=true bun test src/lib/data/search-personal-profiles.test.ts
// Personal profiles in search (Tim, 2026-11-23): signed-out visitors get none; signed-in viewers
// get those with "Show me in search" on, as name, handle and picture only, found by name or handle
// only, unless they are the owner, a superadmin or an accepted connection (the full entry).
// Following doesn't count. Artist, band and venue circles are unchanged. Checks what the server
// sends: searchDiscoverableCircles, Explore's searchContentAction and GET /api/circles/search.
// The database is in-memory fakes; the session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));

const { searchDiscoverableCircles } = await import("./search");
const { searchContentAction } = await import("@/components/modules/search/actions");
const { GET: searchRoute } = await import("@/app/api/circles/search/route");

const OWNER = "did:test:canary-owner";
const STRANGER = "did:test:stranger";
const FOLLOWER = "did:test:follower";
const CONNECTION = "did:test:connection";
const SUPERADMIN = "did:test:superadmin";
const PROFILE_ID = "650000000000000000000061";

const person = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: did.split(":").pop(),
    circleType: "user",
    publishStatus: "published",
    ...extra,
});
const searchableProfile = () =>
    person(OWNER, {
        _id: new ObjectId(PROFILE_ID),
        handle: "canary-person",
        name: "Canary Person",
        picture: { url: "https://cdn.example/canary-face.png" },
        searchable: true,
        mapVisible: true,
        description: "CANARY lifelong beekeeper",
        mission: "CANARY mission",
        skills: ["canaryskill"],
        primaryGenres: ["jazz"],
        members: 4242,
        socialLinks: [{ platform: "instagram", url: "https://instagram.com/CANARY-social" }],
        location: { city: "Canaryville", country: "ZA", precision: 2, lngLat: { lng: 18.4, lat: -33.9 } },
    });
const band = () => ({
    _id: new ObjectId(),
    did: "did:test:band",
    handle: "canary-band",
    name: "Canary Band",
    circleType: "circle",
    publishStatus: "published",
    description: "A band anyone may read about",
    metadata: { peerify: { managedIdentity: true, identityType: "band" } },
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            searchableProfile(),
            person("did:test:hidden-canary", { name: "Canary Hidden", searchable: false }),
            band(),
            person(STRANGER),
            person(FOLLOWER),
            person(CONNECTION),
            person(SUPERADMIN, { isAdmin: true }),
        ],
        UserRelationships: [
            { _id: new ObjectId(), fromDid: CONNECTION, toDid: OWNER, connectStatus: "accepted" },
            { _id: new ObjectId(), fromDid: FOLLOWER, toDid: OWNER, connectStatus: "none", isFollowing: true },
        ],
    });
});

const handles = (circles: { handle?: string }[]) => circles.map((c) => c.handle).sort();
const LIMITED = {
    _id: PROFILE_ID,
    did: OWNER,
    circleType: "user",
    handle: "canary-person",
    name: "Canary Person",
    picture: { url: "https://cdn.example/canary-face.png" },
};
const expectNoPrivateValues = (payload: unknown) => {
    const text = JSON.stringify(payload);
    expect(text).not.toContain("CANARY");
    expect(text).not.toContain("Canaryville");
    expect(text).not.toContain("canaryskill");
    expect(text).not.toContain("4242");
    expect(text).not.toContain("jazz");
    expect(text).not.toContain("-33.9");
};
const routeSearch = async (q: string) =>
    (await (await searchRoute(new Request(`http://test/api/circles/search?q=${q}&limit=25`) as any)).json())
        .circles as any[];

describe("signed out: no personal profiles", () => {
    test("searchDiscoverableCircles, by name and by about text", async () => {
        for (const query of ["canary", "Canary Person", "beekeeper"]) {
            const results = await searchDiscoverableCircles({ query });
            expect(results.every((c) => c.circleType !== "user")).toBe(true);
            expectNoPrivateValues(results);
            expect(JSON.stringify(results)).not.toContain("canary-person");
        }
        expect(handles(await searchDiscoverableCircles({ query: "canary" }))).toEqual(["canary-band"]);
    });

    test("asking for personal profiles only returns nothing", async () => {
        expect(await searchDiscoverableCircles({ query: "canary", circleTypes: ["user"] })).toEqual([]);
    });

    test("Explore's search and /api/circles/search", async () => {
        expect(handles(await searchContentAction("canary", ["users"]))).toEqual(["canary-band"]);
        expect(handles(await routeSearch("canary"))).toEqual(["canary-band"]);
    });
});

describe("signed in, no relationship: name, handle and picture, by name or handle only", () => {
    for (const [who, did] of [
        ["a stranger", STRANGER],
        ["a follower (following doesn't count)", FOLLOWER],
    ] as const) {
        test(`${who}: the limited entry, nothing else in the payload`, async () => {
            sessionDid = did;
            for (const results of [
                await searchDiscoverableCircles({ query: "canary person", viewerDid: did }),
                await searchContentAction("canary person", ["users"]),
                await routeSearch("canary-person"),
            ]) {
                const entry: any = results.find((c) => c.handle === "canary-person");
                const { metrics, ...rest } = entry;
                expect(rest).toEqual(LIMITED);
                expect(metrics?.distance).toBeUndefined();
                expectNoPrivateValues(results);
            }
        });

        test(`${who}: not found through the about text, skills, city or a genre`, async () => {
            for (const query of ["beekeeper", "canaryskill", "Canaryville"]) {
                const results = await searchDiscoverableCircles({ query, viewerDid: did });
                expect(handles(results)).not.toContain("canary-person");
            }
            const byGenre = await searchDiscoverableCircles({
                query: "canary",
                primaryGenres: ["jazz"],
                viewerDid: did,
            });
            expect(handles(byGenre)).not.toContain("canary-person");
        });

        test(`${who}: a profile with "Show me in search" off is not found`, async () => {
            expect(handles(await searchDiscoverableCircles({ query: "canary hidden", viewerDid: did }))).not.toContain(
                "hidden-canary",
            );
        });
    }
});

describe("the owner, an accepted connection and a superadmin: the full entry", () => {
    for (const [who, did] of [
        ["the owner", OWNER],
        ["an accepted connection", CONNECTION],
        ["a superadmin", SUPERADMIN],
    ] as const) {
        test(`${who}: found by the about text too, with the about text`, async () => {
            const results = await searchDiscoverableCircles({ query: "beekeeper", viewerDid: did });
            const entry: any = results.find((c) => c.handle === "canary-person");
            expect(entry.description).toBe("CANARY lifelong beekeeper");
        });
    }

    test("a superadmin also finds a profile with search off", async () => {
        const results = await searchDiscoverableCircles({ query: "canary hidden", viewerDid: SUPERADMIN });
        expect(handles(results)).toContain("hidden-canary");
    });
});

describe("artist, band and venue circles are unchanged", () => {
    test("found by their about text, signed out and as a stranger", async () => {
        for (const viewerDid of [undefined, STRANGER]) {
            const results = await searchDiscoverableCircles({ query: "anyone may read", viewerDid });
            expect(results.find((c) => c.handle === "canary-band")?.description).toBe("A band anyone may read about");
        }
    });
});
