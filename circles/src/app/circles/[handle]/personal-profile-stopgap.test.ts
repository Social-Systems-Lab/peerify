// Run: IS_BUILD=true bun test "src/app/circles/[handle]/personal-profile-stopgap.test.ts"
// Personal profiles, stopgap (Tim, 2026-11-22): a signed-out visitor gets the limited version
// (name, handle, picture) on every personal profile URL, and personal profiles are never indexed
// and never describe themselves in link previews. Artist, band and venue circles are unchanged.
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
const PROFILE_ID = "650000000000000000000011";
const ARTIST_ID = "650000000000000000000012";

// Every value a stranger must not receive carries "CANARY", so one search finds any leak.
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

const profile = () => ({
    _id: new ObjectId(PROFILE_ID),
    did: OWNER,
    handle: "canary-person",
    name: "Canary Person",
    picture: { url: "https://cdn.example/canary-face.png" },
    circleType: "user",
    publishStatus: "published",
    enabledModules: ["home", "feed", "followers", "communities", "settings", "events"],
    searchable: true, // the stopgap doesn't depend on the search or map settings
    mapVisible: true,
    ...PRIVATE_VALUES,
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

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({ Circles: [profile(), artist()], Members: [] });
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
    const element = node as { type?: { name?: string }; props?: { children?: unknown; profile?: unknown } };
    if (element.type && typeof element.type === "function" && element.type.name === name) return true;
    return findByName(element.props?.children, name);
};
const limitedProps = (node: unknown): unknown => {
    const element = node as { type?: { name?: string }; props?: Record<string, unknown> };
    return element?.type?.name === "PersonalProfilePlaceholder" ? element.props : undefined;
};

describe("personal profile page, signed out", () => {
    test("the layout returns only the limited version: name, handle, picture", async () => {
        const tree = await renderLayout("canary-person");
        expect(limitedProps(tree)).toEqual({
            profile: {
                handle: "canary-person",
                name: "Canary Person",
                pictureUrl: "https://cdn.example/canary-face.png",
            },
        });
        const payload = payloadOf(tree);
        expect(payload).not.toContain("CANARY");
        expect(payload).not.toContain("4242");
        expect(payload).not.toContain(OWNER); // not even the did
        expect(payload).not.toContain(PROFILE_ID);
        expect(findByName(tree, "HomeContent")).toBe(false);
        expect(findByName(tree, "CircleTabs")).toBe(false);
    });

    test("the home page renders and sends nothing", async () => {
        expect(await CircleHomePage({ params: Promise.resolve({ handle: "canary-person" }) })).toBeNull();
    });

    test("page title only, no description, never indexed", async () => {
        const metadata = await generateMetadata({
            params: Promise.resolve({ handle: "canary-person" }),
            children: null,
        });
        expect(metadata.title).toBe("Canary Person");
        expect(metadata.description).toBeUndefined();
        expect((metadata.openGraph as any)?.description).toBeUndefined();
        expect(metadata.robots).toEqual({ index: false, follow: false });
        expect(payloadOf(metadata)).not.toContain("CANARY");
    });
});

describe("personal profile page, signed in", () => {
    test("unchanged for now: the full page (the relationship rule comes next)", async () => {
        sessionDid = STRANGER;
        const tree = await renderLayout("canary-person");
        expect(findByName(tree, "HomeContent")).toBe(true);
        expect(limitedProps(tree)).toBeUndefined();
    });

    test("the page title is the name only and noindex for every viewer", async () => {
        sessionDid = OWNER;
        const metadata = await generateMetadata({
            params: Promise.resolve({ handle: "canary-person" }),
            children: null,
        });
        expect(metadata.description).toBeUndefined();
        expect(metadata.robots).toEqual({ index: false, follow: false });
    });
});

describe("artist, band and venue circles keep their public behaviour", () => {
    test("signed out: the full page", async () => {
        const tree = await renderLayout("canary-band");
        expect(findByName(tree, "HomeContent")).toBe(true);
        expect(limitedProps(tree)).toBeUndefined();
    });

    test("signed out: description in the title data, indexable", async () => {
        const metadata = await generateMetadata({ params: Promise.resolve({ handle: "canary-band" }), children: null });
        expect(metadata.description).toBe("A band anyone may read about");
        expect(metadata.robots).toBeUndefined();
    });
});

describe("route check (/api/access)", () => {
    const ask = async (circleHandle: string, moduleHandle: string, circleRoot = false) =>
        (
            await accessPost(
                new Request("http://test/api/access", {
                    method: "POST",
                    body: JSON.stringify({ circleHandle, moduleHandle, circleRoot }),
                }),
            )
        ).json();

    test("signed out: a personal profile's home tab and bare URL pass (they show the limited version)", async () => {
        expect(await ask("canary-person", "home")).toEqual({ authenticated: true, authorized: true });
        expect(await ask("canary-person", "feed", true)).toEqual({ authenticated: true, authorized: true });
    });

    test("signed out: every other tab of a personal profile sends them to sign in", async () => {
        for (const moduleHandle of ["feed", "events", "followers", "communities"]) {
            expect(await ask("canary-person", moduleHandle)).toEqual({ authenticated: false, authorized: false });
        }
    });

    test("signed in: the tabs work as before", async () => {
        sessionDid = STRANGER;
        expect(await ask("canary-person", "feed")).toEqual({ authenticated: true, authorized: true });
    });

    test("signed out: an artist circle's tabs work as before", async () => {
        expect(await ask("canary-band", "feed")).toEqual({ authenticated: true, authorized: true });
    });
});
