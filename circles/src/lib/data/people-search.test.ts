// Run: IS_BUILD=true bun test src/lib/data/people-search.test.ts
// People search and the name-search pickers (Tim, 2026-11-23). Personal profiles: none signed
// out; signed in, only those with "Show me in search" on (any for a superadmin), never one marked
// as an artist in people search; the full entry for the owner, superadmins and accepted
// connections, name, handle and picture for everyone else. The pickers (getCirclesBySearchQuery:
// global create, the event form's artist picker, event invites) use the same rule; event invites
// also find the circle's followers with search off. Accepted connections find each other by name
// and handle even with search off (Tim, 2026-11-23). Checks what the server sends.

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
const { searchAcceptedConnectionsForUserDid } = await import("./relationships");
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
        expect(handles(results)).toEqual(["canary-hidden", "canary-person"]); // search off: a connection
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

    test("an accepted connection: full entries, a connection with search off included", async () => {
        sessionDid = CONNECTION;
        const { circles } = await getCirclesBySearchQueryAction("canary", 25);
        expect(handles(circles)).toContain("canary-hidden");
        expect((circles.find((c) => c.handle === "canary-person") as any).description).toBe("CANARY about text");
        expect((circles.find((c) => c.handle === "canary-hidden") as any).description).toBe("CANARY about text");
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

    test("a follower with search off is found by handle too (2026-11-24)", async () => {
        const found = await getCirclesBySearchQuery("canary-hidden", 10, "user", STRANGER, {
            alsoFindableMembersOf: HOST_CIRCLE_ID,
        });
        expect(handles(found)).toContain("canary-hidden");
        expectNoPrivateValues(found);
    });

    test("a Crew member who chose to hide from the Crew list is still found (Tim, 2026-11-24)", async () => {
        fakeDb
            .col("Circles")
            .docs.push(
                person("did:test:robin", { handle: "robin-crew", name: "Robin Crew", searchable: false, ...PRIVATE }),
            );
        fakeDb.col("Members").docs.push({
            _id: new ObjectId(),
            userDid: "did:test:robin",
            circleId: HOST_CIRCLE_ID,
            userGroups: ["members", "crew"],
            crewVisible: false,
        });
        for (const query of ["Robin", "robin-crew"]) {
            const found = await getCirclesBySearchQuery(query, 10, "user", STRANGER, {
                alsoFindableMembersOf: HOST_CIRCLE_ID,
            });
            expect(handles(found)).toContain("robin-crew");
        }
    });
});

describe("accepted connections find each other with search off (name and handle only)", () => {
    test("searchPeople: by name and by handle, as the full entry", async () => {
        for (const query of ["canary hidden", "canary-hidden"]) {
            const results = await searchPeople({ query, viewerDid: CONNECTION });
            const hidden: any = results.find((c) => c.handle === "canary-hidden");
            expect(hidden?.description).toBe("CANARY about text");
        }
    });

    test("searchPeople: not through the about text or city", async () => {
        for (const query of ["about text", "City"]) {
            expect(handles(await searchPeople({ query, viewerDid: CONNECTION }))).not.toContain("canary-hidden");
        }
    });

    test("the global picker: by handle too", async () => {
        sessionDid = CONNECTION;
        expect(handles((await getCirclesBySearchQueryAction("canary-hid", 25)).circles)).toEqual(["canary-hidden"]);
    });

    test("a stranger still doesn't find a profile with search off", async () => {
        sessionDid = STRANGER;
        expect(handles(await searchPeople({ query: "canary hidden", viewerDid: STRANGER }))).not.toContain(
            "canary-hidden",
        );
        expect(handles((await getCirclesBySearchQueryAction("canary hidden", 25)).circles)).toEqual([]);
    });
});

describe('a leading "@" is ignored (2026-11-24)', () => {
    test("searchPeople: the same results, in the same order, as without it", async () => {
        for (const viewerDid of [STRANGER, CONNECTION]) {
            for (const query of ["canary-person", "canary-hid", "canary"]) {
                const plain = await searchPeople({ query, viewerDid });
                expect(await searchPeople({ query: `@${query}`, viewerDid })).toEqual(plain);
                expect(await searchPeople({ query: `  @${query} `, viewerDid })).toEqual(plain);
            }
        }
    });

    test("searchPeople: '@' alone is an empty search", async () => {
        expect(await searchPeople({ query: "@", viewerDid: STRANGER })).toEqual([]);
    });

    test("the pickers (getCirclesBySearchQuery): found by @handle", async () => {
        sessionDid = CONNECTION;
        expect(handles((await getCirclesBySearchQueryAction("@canary-hid", 25)).circles)).toEqual(["canary-hidden"]);
        expect(handles(await getCirclesBySearchQuery("@canary-person", 25, "user", STRANGER))).toEqual([
            "canary-person",
        ]);
    });

    test("event invites: a follower with search off is found by @handle", async () => {
        const results = await getCirclesBySearchQuery("@canary-hidden", 25, "user", STRANGER, {
            alsoFindableMembersOf: HOST_CIRCLE_ID,
        });
        expect(handles(results)).toEqual(["canary-hidden"]);
    });

    test("event invites from a personal profile (accepted connections): found by @handle", async () => {
        expect(handles(await searchAcceptedConnectionsForUserDid(CONNECTION, "@canary-hid"))).toEqual([
            "canary-hidden",
        ]);
        expect(handles(await searchAcceptedConnectionsForUserDid(CONNECTION, "@"))).toEqual(
            handles(await searchAcceptedConnectionsForUserDid(CONNECTION, "")),
        );
    });

    test("the pickers: '@' alone finds what an empty search finds, nothing more", async () => {
        expect(handles(await getCirclesBySearchQuery("@", 25, "user", STRANGER))).toEqual(
            handles(await getCirclesBySearchQuery("", 25, "user", STRANGER)),
        );
    });
});
