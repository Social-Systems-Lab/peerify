// Run: IS_BUILD=true bun test "src/app/circles/[handle]/parent-circle-leaks.test.ts"
// A venue's parent (Tim's decision on D, 2026-11-15). A venue made from a personal account is that
// account's child circle. Its page hides the "Child of" badge (HomeContent: never for a Peerify
// managed identity), but the circle layout still sent the parent's identity (parentCircle: name,
// handle, picture, DID) to every visitor, and the public circle carried parentCircleId, on the page
// and in the map, search and Discover lists. Now the parent goes out only where the badge shows.
// The database is in-memory fakes; session and permission checks are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";
import type { Circle } from "@/models/models";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const managers = new Set<string>();
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, _circleId: string, feature: unknown) => {
        if (feature === features.settings.edit_about) return !!did && managers.has(did);
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { default: CircleLayout } = await import("./layout");
const { toPublicCircle, toPublicCircleListItem } = await import("@/lib/utils/public-circle");

const OWNER = "did:test:canary-owner";
const OWNER_NAME = "Canary Owner Name";
const OWNER_HANDLE = "canary-owner-handle";
const OWNER_CIRCLE_ID = "650000000000000000000001";
const VENUE_ID = "650000000000000000000002";
const CHILD_ID = "650000000000000000000003";
const FOLLOWER = "did:test:follower";

const venue = () => ({
    _id: new ObjectId(VENUE_ID),
    did: "did:test:venue",
    handle: "venue",
    name: "The Venue",
    circleType: "circle",
    circleLevel: "profile_child",
    parentCircleId: OWNER_CIRCLE_ID,
    createdBy: OWNER,
    publishStatus: "published",
    metadata: { peerify: { managedIdentity: true, identityType: "venue" } },
});
// An ordinary child circle: its page shows "Child of <parent>", so the parent is public there.
const child = () => ({
    _id: new ObjectId(CHILD_ID),
    did: "did:test:child",
    handle: "garden-group",
    name: "Garden group",
    circleType: "circle",
    circleLevel: "profile_child",
    parentCircleId: OWNER_CIRCLE_ID,
    createdBy: OWNER,
    publishStatus: "published",
});

beforeEach(() => {
    sessionDid = undefined;
    managers.clear();
    managers.add(OWNER);
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(OWNER_CIRCLE_ID),
                did: OWNER,
                handle: OWNER_HANDLE,
                name: OWNER_NAME,
                circleType: "user",
                publishStatus: "published",
            },
            venue(),
            child(),
        ],
        Members: [
            { userDid: OWNER, circleId: VENUE_ID, userGroups: ["admins", "moderators", "members"] },
            { userDid: FOLLOWER, circleId: VENUE_ID, userGroups: ["members"] },
        ],
    });
});

// The props the layout hands its client components (HomeCover, HomeContent, CircleTabs).
type Element = { type?: unknown; props?: Record<string, unknown> };
const findProps = (node: unknown, name: string): Record<string, unknown> | undefined => {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findProps(item, name);
            if (found) return found;
        }
        return undefined;
    }
    const element = node as Element;
    const type = element.type as { name?: string; displayName?: string } | undefined;
    if (type && (type.name === name || type.displayName === name)) return element.props;
    return findProps(element.props?.children, name);
};
const renderLayout = async (handle: string) => {
    const previous = process.env.IS_BUILD;
    process.env.IS_BUILD = "false"; // the layout renders nothing during a build
    try {
        const tree = await CircleLayout({ params: Promise.resolve({ handle }), children: null });
        const props = findProps(tree, "HomeContent");
        if (!props) throw new Error("HomeContent not found in the layout");
        return props;
    } finally {
        process.env.IS_BUILD = previous;
    }
};
const namesOwner = (value: unknown) => {
    const text = JSON.stringify(value) ?? "";
    return text.includes(OWNER_NAME) || text.includes(OWNER_HANDLE) || text.includes(OWNER_CIRCLE_ID);
};

describe("venue page (circle layout)", () => {
    for (const [who, did] of [
        ["signed out", undefined],
        ["a follower", FOLLOWER],
    ] as const) {
        test(`${who}: no parent, no parentCircleId`, async () => {
            sessionDid = did;
            const props = await renderLayout("venue");
            expect(props.parentCircle).toBeUndefined();
            expect(Object.keys(props.circle as object)).not.toContain("parentCircleId");
            expect(namesOwner(props)).toBe(false);
        });
    }

    test("an ordinary child circle still sends its parent: its page shows the badge", async () => {
        sessionDid = FOLLOWER;
        const props = await renderLayout("garden-group");
        expect((props.parentCircle as { name?: string })?.name).toBe(OWNER_NAME);
        expect((props.circle as { parentCircleId?: string }).parentCircleId).toBe(OWNER_CIRCLE_ID);
    });
});

describe("public circle shapes", () => {
    const viewer = { viewerDid: FOLLOWER, viewerIsPlatformAdmin: false };

    test("a venue's profile and list item have no parentCircleId for visitors", () => {
        const stored = { ...venue(), _id: VENUE_ID };
        expect(Object.keys(toPublicCircle(stored as never, { ...viewer, viewerCanManage: false }))).not.toContain(
            "parentCircleId",
        );
        expect(Object.keys(toPublicCircleListItem(stored as never, viewer))).not.toContain("parentCircleId");
        expect(Object.keys(toPublicCircleListItem(stored as never, { viewerIsPlatformAdmin: false }))).not.toContain(
            "parentCircleId",
        );
    });

    test("the venue's managers still get it (settings read it)", () => {
        const stored = { ...venue(), _id: VENUE_ID };
        expect(toPublicCircle(stored as never, { ...viewer, viewerCanManage: true }).parentCircleId).toBe(
            OWNER_CIRCLE_ID,
        );
        expect(
            toPublicCircle(stored as never, { viewerDid: OWNER, viewerIsPlatformAdmin: false, viewerCanManage: false })
                .parentCircleId,
        ).toBe(OWNER_CIRCLE_ID);
    });

    test("an ordinary child circle keeps parentCircleId", () => {
        const stored = { ...child(), _id: CHILD_ID };
        expect(toPublicCircleListItem(stored as unknown as Circle, viewer).parentCircleId).toBe(OWNER_CIRCLE_ID);
    });
});
