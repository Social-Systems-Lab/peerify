// Run: IS_BUILD=true bun test src/app/spaces-owner.test.ts
// The owner's spaces through the real server actions and the Settings → Spaces page
// (src/app/circles/[handle]/settings/spaces). The database is in-memory fakes (testing/fake-db.ts)
// and the session is stubbed; nothing real is touched.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));

class NotFound extends Error {}
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    notFound: () => {
        throw new NotFound("NEXT_NOT_FOUND");
    },
}));

// The page looks its profile up by handle; the rest of circle.ts isn't needed.
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCircleByHandle: async (handle: string) =>
        fakeDb.col("Circles").docs.find((c) => c.handle === handle) ?? null,
}));

const { createSpaceAction, deleteSpaceAction, getMySpacesAction, updateSpaceAction } = await import(
    "@/app/circles/[handle]/settings/spaces/actions"
);
const { default: SpacesSettingsPage } = await import("@/app/circles/[handle]/settings/spaces/page");

const ALICE = "did:test:alice";
const BOB = "did:test:bob";
const NEWBIE = "did:test:newbie";

const LOCATION = {
    precision: 4,
    city: "Uppsala",
    country: "Sweden",
    street: "Svartbäcksgatan 12",
    lngLat: { lng: 17.63891, lat: 59.86207 },
};

const privateInput = (overrides: Record<string, unknown> = {}) => ({
    type: "private",
    location: LOCATION,
    capacity: 20,
    setting: ["indoor", "outdoor"],
    amplification: "amplified_ok",
    stepFreeAccess: "accessible",
    dealPreferences: ["none"],
    notesForPeerify: "Cat in the house",
    listeningRuleAccepted: true,
    hostResponsibilityAccepted: true,
    ...overrides,
});

const stored = () => fakeDb.col("Spaces").docs;
const as = (did: string | undefined) => {
    sessionDid = did;
};

beforeEach(() => {
    fakeDb.reset({
        Circles: [
            { _id: "c-alice", did: ALICE, handle: "alice", circleType: "user", isVerified: true },
            { _id: "c-bob", did: BOB, handle: "bob", circleType: "user", verificationStatus: "verified" },
            { _id: "c-newbie", did: NEWBIE, handle: "newbie", circleType: "user" },
            { _id: "c-band", did: "did:test:band", handle: "band", circleType: "circle" },
        ],
    });
    as(undefined);
});

const aliceSpaceId = async () => {
    as(ALICE);
    const result = await createSpaceAction(privateInput());
    if (!result.success) throw new Error(result.message);
    return result.spaces[0]._id;
};

describe("server actions", () => {
    test("signed out: every action is refused and nothing is written", async () => {
        const id = await aliceSpaceId();
        as(undefined);
        const before = JSON.stringify(stored());
        expect((await getMySpacesAction()).success).toBe(false);
        expect((await createSpaceAction(privateInput())).success).toBe(false);
        expect((await updateSpaceAction(id, privateInput({ capacity: 5 }))).success).toBe(false);
        expect((await deleteSpaceAction(id)).success).toBe(false);
        expect(JSON.stringify(stored())).toBe(before);
    });

    test("adding a space needs a verified account", async () => {
        as(NEWBIE);
        const result = await createSpaceAction(privateInput());
        expect(result).toEqual({
            success: false,
            message: "You need to verify your account before you can add a space.",
        });
        expect(stored()).toHaveLength(0);
    });

    test("the owner is the signed-in person, whatever the client sends", async () => {
        as(ALICE);
        await createSpaceAction({ ...privateInput(), ownerDid: BOB });
        expect(stored()[0].ownerDid).toBe(ALICE);
    });

    test("a private space is stored with its area only", async () => {
        await aliceSpaceId();
        const raw = stored()[0];
        expect(raw.location).toEqual({ precision: 2, city: "Uppsala", country: "Sweden", lngLat: { lng: 17.6, lat: 59.9 } });
        expect(JSON.stringify(raw)).not.toContain("Svartbäcksgatan");
    });

    test("another person can't list, edit or delete the owner's space", async () => {
        const id = await aliceSpaceId();
        const before = JSON.stringify(stored());
        as(BOB);
        expect(await getMySpacesAction()).toEqual({ success: true, spaces: [] });
        const edit = await updateSpaceAction(id, privateInput({ capacity: 99 }));
        const remove = await deleteSpaceAction(id);
        expect(edit.success).toBe(false);
        expect(remove.success).toBe(false);
        // Bob's errors don't reveal the space: the same message as for an id that never existed.
        expect(edit).toEqual(await updateSpaceAction("0123456789abcdef01234567", privateInput()));
        expect(JSON.stringify(stored())).toBe(before);
    });

    test("the owner can edit and delete", async () => {
        const id = await aliceSpaceId();
        const edited = await updateSpaceAction(id, privateInput({ capacity: 30 }));
        expect(edited.success && edited.spaces[0].capacity).toBe(30);
        const deleted = await deleteSpaceAction(id);
        expect(deleted).toEqual({ success: true, spaces: [] });
        expect(stored()).toHaveLength(0);
    });

    test("invalid input is refused with a reason", async () => {
        as(ALICE);
        const result = await createSpaceAction(privateInput({ dealPreferences: ["none", "fixed_fee"] }));
        expect(result.success).toBe(false);
        expect(!result.success && result.message).toContain("dealPreferences");
        expect(stored()).toHaveLength(0);
    });

    test("the 11th space is refused", async () => {
        as(ALICE);
        for (let i = 0; i < 10; i++) {
            expect((await createSpaceAction(privateInput())).success).toBe(true);
        }
        expect(await createSpaceAction(privateInput())).toEqual({
            success: false,
            message: "You can add up to 10 spaces. Delete one to add another.",
        });
        expect(stored()).toHaveLength(10);
    });
});

describe("Settings → Spaces page", () => {
    const open = async (handle: string): Promise<"page" | "404"> => {
        try {
            await SpacesSettingsPage({ params: Promise.resolve({ handle }) });
            return "page";
        } catch (error) {
            if (error instanceof NotFound) return "404";
            throw error;
        }
    };

    test("the owner gets the page", async () => {
        await aliceSpaceId();
        expect(await open("alice")).toBe("page");
    });

    test("anyone else gets a 404: another person, a signed-out visitor, a non-personal circle", async () => {
        await aliceSpaceId();
        as(BOB);
        expect(await open("alice")).toBe("404");
        as(undefined);
        expect(await open("alice")).toBe("404");
        as("did:test:band");
        expect(await open("band")).toBe("404");
        as(ALICE);
        expect(await open("nobody")).toBe("404");
    });

    test("a platform admin gets a 404 too (admins use /admin/spaces)", async () => {
        await aliceSpaceId();
        fakeDb.col("Circles").docs.push({ did: "did:test:admin", handle: "admin", circleType: "user", isAdmin: true });
        as("did:test:admin");
        expect(await open("alice")).toBe("404");
    });
});
