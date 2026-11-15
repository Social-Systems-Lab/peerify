// Run: IS_BUILD=true bun test "src/app/circles/[handle]/communities/profile-circles-leaks.test.ts"
// A personal profile's Circles tab (Tim, 2026-11-15). It listed the circles made under the profile,
// such as a venue the person runs, to everyone, signed out too, with no setting to stop it (personal
// profiles hide Pages and Access rules). Now the list, its page, its data and its tab are for the
// profile's owner and platform admins only. A band's or venue's own Circles tab is unchanged. The
// database is in-memory fakes; the session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    notFound: () => {
        throw new Error("NOT_FOUND");
    },
}));

const { default: CirclesPage } = await import("./page");
const { default: CirclesModule } = await import("@/components/modules/circles/circles");
const { POST: access } = await import("@/app/api/access/route");
const { canSeeProfileCirclesTab } = await import("@/lib/peerify/profile-circles-list");

const OWNER = "did:test:canary-owner";
const OTHER = "did:test:other";
const ADMIN = "did:test:platform-admin";
const OWNER_CIRCLE_ID = "652000000000000000000001";
const VENUE_ID = "652000000000000000000002";
const BAND_ID = "652000000000000000000003";
const BAND_CHILD_ID = "652000000000000000000004";
const VENUE_NAME = "CANARY SECRET VENUE";

const MODULES = ["home", "feed", "followers", "communities", "settings", "events"];

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(OWNER_CIRCLE_ID),
                did: OWNER,
                handle: "canary-owner",
                name: "Canary Owner",
                circleType: "user",
                publishStatus: "published",
                enabledModules: MODULES,
            },
            { _id: new ObjectId(), did: OTHER, handle: "other", name: "Other", circleType: "user" },
            { _id: new ObjectId(), did: ADMIN, handle: "admin", name: "Admin", circleType: "user", isAdmin: true },
            {
                _id: new ObjectId(VENUE_ID),
                did: "did:test:venue",
                handle: "venue",
                name: VENUE_NAME,
                circleType: "circle",
                parentCircleId: OWNER_CIRCLE_ID,
                createdBy: OWNER,
                publishStatus: "published",
                metadata: { peerify: { managedIdentity: true, identityType: "venue" } },
            },
            {
                _id: new ObjectId(BAND_ID),
                did: "did:test:band",
                handle: "band",
                name: "The Band",
                circleType: "circle",
                publishStatus: "published",
                enabledModules: MODULES,
            },
            {
                _id: new ObjectId(BAND_CHILD_ID),
                did: "did:test:band-child",
                handle: "band-side-project",
                name: "Band side project",
                circleType: "circle",
                parentCircleId: BAND_ID,
                publishStatus: "published",
            },
        ],
        Members: [{ userDid: OWNER, circleId: VENUE_ID, userGroups: ["admins", "moderators", "members"] }],
    });
});

const props = (handle: string) => ({ params: Promise.resolve({ handle }), searchParams: Promise.resolve({}) });
const openPage = async (handle: string) => {
    try {
        return await CirclesPage(props(handle));
    } catch (error) {
        if (error instanceof Error && error.message === "NOT_FOUND") return "NOT_FOUND";
        throw error;
    }
};
// The data the list would send to the browser: render the module the page returns.
const listData = async (handle: string) => {
    const page = await openPage(handle);
    if (page === "NOT_FOUND") return "NOT_FOUND";
    const element = page as { props: Parameters<typeof CirclesModule>[0] };
    return JSON.stringify((await CirclesModule(element.props)) ?? null);
};
const guard = async (handle: string) => {
    const response = await access(
        new Request("http://localhost/api/access", {
            method: "POST",
            body: JSON.stringify({ userDid: sessionDid, circleHandle: handle, moduleHandle: "communities" }),
        }),
    );
    return (await response.json()) as { authorized?: boolean; notFound?: boolean };
};

describe("a personal profile's Circles list", () => {
    for (const [who, did] of [
        ["a signed-out visitor", undefined],
        ["another signed-in user", OTHER],
    ] as const) {
        test(`${who}: no page, no data, the route guard refuses`, async () => {
            sessionDid = did;
            const data = await listData("canary-owner");
            expect(data === "NOT_FOUND" || !data.includes(VENUE_NAME)).toBe(true);
            expect(data).toBe("NOT_FOUND");
            const result = await guard("canary-owner");
            expect(result.authorized === true).toBe(false);
        });
    }

    test("the owner still gets the list, with the venue", async () => {
        sessionDid = OWNER;
        expect(await listData("canary-owner")).toContain(VENUE_NAME);
        expect((await guard("canary-owner")).authorized).toBe(true);
    });

    test("a platform admin still gets it", async () => {
        sessionDid = ADMIN;
        expect(await listData("canary-owner")).toContain(VENUE_NAME);
        expect((await guard("canary-owner")).authorized).toBe(true);
    });
});

describe("other circles are unchanged", () => {
    test("a band's Circles list is still public", async () => {
        for (const did of [undefined, OTHER]) {
            sessionDid = did;
            expect(await listData("band")).toContain("Band side project");
            expect((await guard("band")).authorized).toBe(true);
        }
    });
});

describe("the Circles tab", () => {
    const profile = { circleType: "user" as const, did: OWNER };
    test("shows on a personal profile for its owner and platform admins only", () => {
        expect(canSeeProfileCirclesTab(profile, undefined)).toBe(false);
        expect(canSeeProfileCirclesTab(profile, { did: OTHER })).toBe(false);
        expect(canSeeProfileCirclesTab(profile, { did: OWNER })).toBe(true);
        expect(canSeeProfileCirclesTab(profile, { did: ADMIN, isAdmin: true })).toBe(true);
    });

    test("shows on other circles as before", () => {
        expect(canSeeProfileCirclesTab({ circleType: "circle", did: "did:test:band" }, undefined)).toBe(true);
    });
});
