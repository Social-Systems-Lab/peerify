// Run: IS_BUILD=true bun test src/lib/data/people-search.test.ts
// People search and the name-search pickers (Tim, 2026-11-23). Personal profiles: none signed
// out; signed in, only those with "Show me in search" on (any for a superadmin), never one marked
// as an artist in people search; the full entry for the owner, superadmins and accepted
// connections, name, handle and picture for everyone else. The pickers (getCirclesBySearchQuery:
// global create, the event form's artist picker, event invites) use the same rule; event invites
// also find the circle's followers with search off. Checks what the server sends.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));

const { searchPeople } = await import("./search");
const { getCirclesBySearchQuery } = await import("./circle");
const { getCirclesBySearchQueryAction, searchArtistCirclesAction } = await import(
    "@/app/circles/[handle]/events/actions"
);

const OWNER = "did:test:canary-owner";
const STRANGER = "did:test:stranger";
const CONNECTION = "did:test:connection";
const SUPERADMIN = "did:test:superadmin";
const HIDDEN = "did:test:hidden";
const SOLO = "did:test:solo";
const PROFILE_ID = "650000000000000000000071";
const HOST_CIRCLE_ID = "650000000000000000000072";

const person = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: did.split(":").pop(),
    circleType: "user",
    publishStatus: "published",
    ...extra,
});
const PRIVATE = {
    description: "CANARY about text",
    members: 4242,
    socialLinks: [{ platform: "instagram", url: "https://instagram.com/CANARY-social" }],
    location: { city: "CANARY City", country: "ZA", precision: 2, lngLat: { lng: 18.4, lat: -33.9 } },
};

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            person(OWNER, {
                _id: new ObjectId(PROFILE_ID),
                handle: "canary-person",
                name: "Canary Person",
                picture: { url: "https://cdn.example/canary-face.png" },
                searchable: true,
                ...PRIVATE,
            }),
            person(HIDDEN, { handle: "canary-hidden", name: "Canary Hidden", searchable: false, ...PRIVATE }),
            person(SOLO, {
                handle: "canary-solo",
                name: "Canary Solo",
                searchable: true,
                metadata: { peerify: { intent: "artist" } },
                ...PRIVATE,
            }),
            {
                _id: new ObjectId(HOST_CIRCLE_ID),
                did: "did:test:band",
                handle: "canary-band",
                name: "Canary Band",
                circleType: "circle",
                publishStatus: "published",
                description: "A band anyone may read about",
                metadata: { peerify: { managedIdentity: true, identityType: "band" } },
            },
            person(STRANGER),
            person(CONNECTION),
            person(SUPERADMIN, { isAdmin: true }),
        ],
        Members: [{ _id: new ObjectId(), userDid: HIDDEN, circleId: HOST_CIRCLE_ID, userGroups: ["members"] }],
        UserRelationships: [
            { _id: new ObjectId(), fromDid: CONNECTION, toDid: OWNER, connectStatus: "accepted" },
            { _id: new ObjectId(), fromDid: CONNECTION, toDid: HIDDEN, connectStatus: "accepted" },
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
    expect(text).not.toContain("4242");
    expect(text).not.toContain("-33.9");
};

describe("searchPeople", () => {
    test("signed out: nothing", async () => {
        expect(await searchPeople({ query: "canary" })).toEqual([]);
    });

    test("a stranger: the searchable profile, limited; not one with search off or marked as an artist", async () => {
        const results = await searchPeople({ query: "canary", viewerDid: STRANGER });
        expect(handles(results)).toEqual(["canary-person"]);
        const { metrics: _metrics, ...entry } = results[0] as any;
        expect(entry).toEqual(LIMITED);
        expectNoPrivateValues(results);
    });

    test("an accepted connection: the full entry", async () => {
        const results = await searchPeople({ query: "canary", viewerDid: CONNECTION });
        expect(handles(results)).toEqual(["canary-person"]);
        expect((results[0] as any).description).toBe("CANARY about text");
    });

    test("the owner: the full entry", async () => {
        const results = await searchPeople({ query: "canary person", viewerDid: OWNER });
        expect((results[0] as any).description).toBe("CANARY about text");
    });

    test("a superadmin: full entries, search off included, never one marked as an artist", async () => {
        const results = await searchPeople({ query: "canary", viewerDid: SUPERADMIN });
        expect(handles(results)).toEqual(["canary-hidden", "canary-person"]);
        expect(results.every((c: any) => c.description === "CANARY about text")).toBe(true);
    });
});

describe("the global-create name-search picker (getCirclesBySearchQueryAction)", () => {
    test("signed out: nothing", async () => {
        expect((await getCirclesBySearchQueryAction("canary", 25)).circles).toEqual([]);
    });

    test("a stranger: searchable profiles limited, search off left out, the band as before", async () => {
        sessionDid = STRANGER;
        const { circles } = await getCirclesBySearchQueryAction("canary", 25);
        expect(handles(circles)).toEqual(["canary-band", "canary-person", "canary-solo"]);
        expect(circles.find((c) => c.handle === "canary-person")).toEqual(LIMITED as any);
        expectNoPrivateValues(circles.filter((c) => c.circleType === "user"));
        expect(circles.find((c) => c.handle === "canary-band")?.description).toBe("A band anyone may read about");
    });

    test("an accepted connection: full entries for searchable profiles; search off still left out", async () => {
        sessionDid = CONNECTION;
        const { circles } = await getCirclesBySearchQueryAction("canary", 25);
        expect(handles(circles)).not.toContain("canary-hidden");
        expect((circles.find((c) => c.handle === "canary-person") as any).description).toBe("CANARY about text");
    });

    test("the owner finds their own profile with search off", async () => {
        sessionDid = HIDDEN;
        const { circles } = await getCirclesBySearchQueryAction("canary hidden", 25);
        expect(handles(circles)).toEqual(["canary-hidden"]);
    });
});

describe("the event form's artist picker (searchArtistCirclesAction)", () => {
    test("a stranger: a personal profile marked as an artist is still found, as name, handle and picture", async () => {
        sessionDid = STRANGER;
        const { circles } = await searchArtistCirclesAction("canary", 10);
        expect(handles(circles)).toEqual(["canary-band", "canary-solo"]);
        const solo: any = circles.find((c) => c.handle === "canary-solo");
        expect(Object.keys(solo).sort()).toEqual(["_id", "circleType", "did", "handle", "name"]);
        expectNoPrivateValues(solo);
    });
});

describe("event invites: the circle's followers are found with search off", () => {
    test("a follower with search off is found, limited; without the option they are not", async () => {
        const withFollowers = await getCirclesBySearchQuery("canary", 10, "user", STRANGER, {
            alsoFindableMembersOf: HOST_CIRCLE_ID,
        });
        expect(handles(withFollowers)).toContain("canary-hidden");
        expect(Object.keys(withFollowers.find((c) => c.handle === "canary-hidden")!).sort()).toEqual([
            "_id",
            "circleType",
            "did",
            "handle",
            "name",
        ]);
        expectNoPrivateValues(withFollowers);
        expect(handles(await getCirclesBySearchQuery("canary", 10, "user", STRANGER))).not.toContain("canary-hidden");
    });
});
