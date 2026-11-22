// Run: IS_BUILD=true bun test "src/app/circles/[handle]/personal-profile-page.test.ts"
// Personal profile pages (Tim, 2026-11-22). The owner, superadmins and the owner's accepted
// connections get the full profile; everyone else (signed out, a signed-in stranger, a follower)
// gets the limited version: name, handle and picture only. The search and map settings play no
// part. Personal profiles are never indexed and never describe themselves in link previews.
// Artist, band and venue circles are unchanged.
// These tests look at what the server hands to the page (the props payload), not just the screen.
// The database is in-memory fakes; the session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async () => false,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { default: CircleLayout, generateMetadata } = await import("./layout");
const { default: CircleHomePage } = await import("./home/page");
const { POST: accessPost } = await import("@/app/api/access/route");

const OWNER = "did:test:canary-owner";
const STRANGER = "did:test:stranger";
const FOLLOWER = "did:test:follower";
const CONNECTION = "did:test:connection";
const PENDING = "did:test:pending-connection";
const SUPERADMIN = "did:test:superadmin";
const PROFILE_ID = "650000000000000000000011";
const ARTIST_ID = "650000000000000000000012";

// Every value a limited viewer must not receive carries "CANARY", so one search finds any leak.
const PRIVATE_VALUES = {
    description: "CANARY description of my life",
    mission: "CANARY mission",
    content: "CANARY long about text",
    members: 4242,
    socialLinks: [{ platform: "instagram", url: "https://instagram.com/CANARY-social" }],
    websiteUrl: "https://CANARY-website.example",
    interests: ["CANARY-interest"],
    causes: ["CANARY-cause"],
    skills: ["CANARY-skill"],
    images: [{ fileInfo: { url: "https://cdn.example/CANARY-cover.png" } }],
    location: { city: "CANARY City", country: "ZA", lngLat: { lng: 18.4, lat: -33.9 } },
};

const user = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: did,
    circleType: "user",
    publishStatus: "published",
    ...extra,
});
const profile = (extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(PROFILE_ID),
    did: OWNER,
    handle: "canary-person",
    name: "Canary Person",
    picture: { url: "https://cdn.example/canary-face.png" },
    circleType: "user",
    publishStatus: "published",
    enabledModules: ["home", "feed", "followers", "communities", "settings", "events"],
    searchable: true, // the search and map settings play no part
    mapVisible: true,
    ...PRIVATE_VALUES,
    ...extra,
});
const artist = () => ({
    _id: new ObjectId(ARTIST_ID),
    did: "did:test:artist",
    handle: "canary-band",
    name: "Canary Band",
    circleType: "circle",
    publishStatus: "published",
    enabledModules: ["home", "feed", "followers", "settings"],
    createdBy: OWNER,
    description: "A band anyone may read about",
    members: 12,
    metadata: { peerify: { managedIdentity: true, identityType: "artist" } },
});
const edge = (fromDid: string, toDid: string, connectStatus: string) => ({
    _id: new ObjectId(),
    fromDid,
    toDid,
    connectStatus,
    isFollowing: false,
});

const seed = (profileExtra: Record<string, unknown> = {}) =>
    fakeDb.reset({
        Circles: [
            profile(profileExtra),
            artist(),
            user(STRANGER),
            user(FOLLOWER),
            user(CONNECTION),
            user(PENDING),
            user(SUPERADMIN, { isAdmin: true }),
        ],
        Members: [
            { userDid: OWNER, circleId: PROFILE_ID, userGroups: ["admins", "moderators", "members"] },
            { userDid: FOLLOWER, circleId: PROFILE_ID, userGroups: ["members"] },
        ],
        UserRelationships: [
            edge(CONNECTION, OWNER, "accepted"),
            edge(OWNER, CONNECTION, "accepted"),
            edge(PENDING, OWNER, "pending"),
            { ...edge(FOLLOWER, OWNER, "none"), isFollowing: true },
        ],
    });

beforeEach(() => {
    sessionDid = undefined;
    seed();
});

const CHILD = { type: "div", props: { "data-child-route": "CANARY child route" } };
const renderLayout = async (handle: string) => {
    const previous = process.env.IS_BUILD;
    process.env.IS_BUILD = "false"; // the layout renders nothing during a build
    try {
        return await CircleLayout({ params: Promise.resolve({ handle }), children: CHILD as any });
    } finally {
        process.env.IS_BUILD = previous;
    }
};

// What would be serialised for the browser: every prop of every element, recursively.
const payloadOf = (node: unknown): string => JSON.stringify(node) ?? "";
const findByName = (node: unknown, name: string): boolean => {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some((item) => findByName(item, name));
    const element = node as { type?: { name?: string }; props?: { children?: unknown } };
    if (element.type && typeof element.type === "function" && element.type.name === name) return true;
    return findByName(element.props?.children, name);
};
const limitedProps = (node: unknown): unknown => {
    const element = node as { type?: { name?: string }; props?: Record<string, unknown> };
    return element?.type?.name === "PersonalProfilePlaceholder" ? element.props : undefined;
};
const LIMITED = {
    handle: "canary-person",
    name: "Canary Person",
    pictureUrl: "https://cdn.example/canary-face.png",
};
const metadataFor = (handle: string) => generateMetadata({ params: Promise.resolve({ handle }), children: null });
const ask = async (circleHandle: string, moduleHandle: string, circleRoot = false) =>
    (
        await accessPost(
            new Request("http://test/api/access", {
                method: "POST",
                body: JSON.stringify({ circleHandle, moduleHandle, circleRoot }),
            }),
        )
    ).json();

const LIMITED_VIEWERS = [
    ["signed out", undefined],
    ["a signed-in stranger", STRANGER],
    ["a follower (following doesn't count)", FOLLOWER],
    ["someone whose connection request is still pending", PENDING],
] as const;
const FULL_VIEWERS = [
    ["the owner", OWNER],
    ["an accepted connection", CONNECTION],
    ["a superadmin", SUPERADMIN],
] as const;

describe("personal profile page: the limited version", () => {
    for (const [who, did] of LIMITED_VIEWERS) {
        test(`${who}: the layout sends name, handle and picture only`, async () => {
            sessionDid = did;
            const tree = await renderLayout("canary-person");
            expect(limitedProps(tree)).toEqual({ profile: LIMITED, signedIn: !!did });
            const payload = payloadOf(tree);
            expect(payload).not.toContain("CANARY");
            expect(payload).not.toContain("4242");
            expect(payload).not.toContain(OWNER); // not even the did
            expect(payload).not.toContain(PROFILE_ID);
            expect(findByName(tree, "HomeContent")).toBe(false);
            expect(findByName(tree, "CircleTabs")).toBe(false);
        });

        test(`${who}: the home page renders and sends nothing`, async () => {
            sessionDid = did;
            expect(await CircleHomePage({ params: Promise.resolve({ handle: "canary-person" }) })).toBeNull();
        });

        test(`${who}: only the home tab and the bare URL pass the route check`, async () => {
            sessionDid = did;
            expect(await ask("canary-person", "home")).toEqual({ authenticated: true, authorized: true });
            expect(await ask("canary-person", "feed", true)).toEqual({ authenticated: true, authorized: true });
            for (const moduleHandle of ["feed", "events", "followers", "communities"]) {
                expect(await ask("canary-person", moduleHandle)).toEqual({ authenticated: !!did, authorized: false });
            }
        });
    }

    test("the search and map settings make no difference", async () => {
        seed({ searchable: false, mapVisible: false });
        sessionDid = STRANGER;
        expect(limitedProps(await renderLayout("canary-person"))).toEqual({ profile: LIMITED, signedIn: true });
        seed({ searchable: true, mapVisible: true });
        expect(limitedProps(await renderLayout("canary-person"))).toEqual({ profile: LIMITED, signedIn: true });
    });
});

describe("personal profile page: the full profile", () => {
    for (const [who, did] of FULL_VIEWERS) {
        test(`${who}: the full page`, async () => {
            sessionDid = did;
            const tree = await renderLayout("canary-person");
            expect(limitedProps(tree)).toBeUndefined();
            expect(findByName(tree, "HomeContent")).toBe(true);
            expect(payloadOf(tree)).toContain("CANARY description of my life");
        });

        test(`${who}: the tabs pass the route check`, async () => {
            sessionDid = did;
            expect(await ask("canary-person", "feed")).toEqual({ authenticated: true, authorized: true });
            expect(await ask("canary-person", "events")).toEqual({ authenticated: true, authorized: true });
        });
    }
});

describe("page title and link previews", () => {
    for (const [who, did] of [...LIMITED_VIEWERS, ...FULL_VIEWERS]) {
        test(`${who}: the name only, no description, never indexed`, async () => {
            sessionDid = did;
            const metadata = await metadataFor("canary-person");
            expect(metadata.title).toBe("Canary Person");
            expect(metadata.description).toBeUndefined();
            expect((metadata.openGraph as any)?.description).toBeUndefined();
            expect(metadata.robots).toEqual({ index: false, follow: false });
            expect(payloadOf(metadata)).not.toContain("CANARY");
        });
    }
});

describe("artist, band and venue circles keep their public behaviour", () => {
    for (const [who, did] of [
        ["signed out", undefined],
        ["a signed-in stranger", STRANGER],
    ] as const) {
        test(`${who}: the full page, description in the title data, tabs open`, async () => {
            sessionDid = did;
            const tree = await renderLayout("canary-band");
            expect(findByName(tree, "HomeContent")).toBe(true);
            expect(limitedProps(tree)).toBeUndefined();
            const metadata = await metadataFor("canary-band");
            expect(metadata.description).toBe("A band anyone may read about");
            expect(metadata.robots).toBeUndefined();
            expect(await ask("canary-band", "feed")).toEqual({ authenticated: true, authorized: true });
        });
    }
});
