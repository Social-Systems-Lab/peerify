// Run: IS_BUILD=true bun test "src/app/circles/[handle]/followers/followers-leaks-d2.test.ts"
// Leak round 3, M2, Tim's decision D2 (2026-11-07): follower lists were public by default, also for
// personal profiles (who follows a person) and circles where following needs approval. Now:
// - a personal profile's list is for its owner only, and its Followers tab and follower link are
//   hidden for everyone else;
// - an approval-required circle's list is for its followers (and platform admins, and someone with a
//   pending admin invitation, who answers it on that page); the event invite picker
//   (getCircleMembersAction) follows the same rule;
// - open artist, venue and other circles: unchanged;
// - Crew and custom group labels only for the circle's admins and moderators.
// The database is in-memory fakes; the session is stubbed and the permission checks are real.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const PERSON_ID = "64f700000000000000000001"; // a personal profile
const CLOSED_ID = "64f700000000000000000002"; // a band, following needs approval
const OPEN_ID = "64f700000000000000000003"; // a band, open to follow
const OWNER = "did:test:owner"; // owns the personal profile
const ADMIN = "did:test:admin"; // admin of both bands
const MODERATOR = "did:test:moderator";
const FAN = "did:test:fan"; // follows everything
const STRANGER = "did:test:stranger";
const PLATFORM_ADMIN = "did:test:platform-admin";
const INVITEE = "did:test:invitee"; // pending admin invitation to the closed band

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));

class Redirect extends Error {
    constructor(public url: string) {
        super("NEXT_REDIRECT");
    }
}
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    redirect: (url: string) => {
        throw new Redirect(url);
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCircleByHandle: async (handle: string) => fakeDb.col("Circles").docs.find((c) => c.handle === handle) ?? null,
}));

const { default: FollowersPage } = await import("./page");
const { getMembersWithMetrics } = await import("@/lib/data/member");
const { getCircleMembersAction } = await import("../events/actions");
const { canSeeFollowersLink } = await import("@/lib/peerify/follower-list");

const person = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: did,
    circleType: "user",
    isVerified: true,
    ...extra,
});
const row = (userDid: string, circleId: string, userGroups: string[]) => ({
    _id: new ObjectId().toString(),
    userDid,
    circleId,
    userGroups,
    name: userDid,
    handle: userDid.split(":").pop(),
    did: userDid,
    joinedAt: new Date("2026-10-01"),
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(PERSON_ID), did: OWNER, handle: "owner", name: "Owner", circleType: "user", isPublic: true },
            { _id: new ObjectId(CLOSED_ID), did: "did:test:closed", handle: "closed", name: "Closed", circleType: "circle" },
            { _id: new ObjectId(OPEN_ID), did: "did:test:open", handle: "open", name: "Open", circleType: "circle", isPublic: true },
            person(ADMIN),
            person(MODERATOR),
            person(FAN),
            person(STRANGER),
            person(INVITEE),
            person(PLATFORM_ADMIN, { isAdmin: true }),
        ],
        Members: [
            { userDid: OWNER, circleId: PERSON_ID, userGroups: ["admins", "members"] },
            { userDid: FAN, circleId: PERSON_ID, userGroups: ["members"] },
            ...[CLOSED_ID, OPEN_ID].flatMap((circleId) => [
                { userDid: ADMIN, circleId, userGroups: ["admins", "members"] },
                { userDid: MODERATOR, circleId, userGroups: ["moderators", "members"] },
                { userDid: FAN, circleId, userGroups: ["members", "crew", "vip-list"] },
            ]),
        ],
        AdminInvitations: [{ circleId: CLOSED_ID, invitedUserDid: INVITEE, status: "pending" }],
    });
    fakeDb.setAggregateResult(
        "Members",
        [
            row(ADMIN, OPEN_ID, ["admins", "members"]),
            row(MODERATOR, OPEN_ID, ["moderators", "members"]),
            row(FAN, OPEN_ID, ["members", "crew", "vip-list"]),
        ],
    );
});

const open = async (handle: string) => {
    try {
        await FollowersPage({ params: Promise.resolve({ handle }), searchParams: Promise.resolve({}) });
        return "shown";
    } catch (error) {
        if (error instanceof Redirect) return "denied";
        throw error;
    }
};

describe("a personal profile's follower list: owner only", () => {
    test("the owner sees it", async () => {
        sessionDid = OWNER;
        expect(await open("owner")).toBe("shown");
    });

    test("a follower, a stranger, a platform admin and a logged-out visitor don't", async () => {
        for (const viewer of [FAN, STRANGER, PLATFORM_ADMIN, undefined]) {
            sessionDid = viewer;
            expect(await open("owner")).toBe("denied");
        }
    });

    test("the Followers tab and follower link: shown to the owner only; other circles unchanged", () => {
        const profile = { circleType: "user" as const, did: OWNER };
        expect(canSeeFollowersLink(profile, OWNER)).toBe(true);
        for (const viewer of [FAN, STRANGER, undefined]) expect(canSeeFollowersLink(profile, viewer)).toBe(false);
        expect(canSeeFollowersLink({ circleType: "circle", did: "did:test:open" }, undefined)).toBe(true);
    });
});

describe("an approval-required circle: followers only", () => {
    test("a follower, an admin, a platform admin and a pending admin invitee see it", async () => {
        for (const viewer of [FAN, ADMIN, PLATFORM_ADMIN, INVITEE]) {
            sessionDid = viewer;
            expect(await open("closed")).toBe("shown");
        }
    });

    test("a stranger and a logged-out visitor don't", async () => {
        for (const viewer of [STRANGER, undefined]) {
            sessionDid = viewer;
            expect(await open("closed")).toBe("denied");
        }
    });

    test("the event invite picker follows the same rule", async () => {
        sessionDid = STRANGER;
        expect((await getCircleMembersAction("closed")).members).toEqual([]);
    });
});

describe("an open circle: unchanged", () => {
    test("a stranger and a logged-out visitor see it", async () => {
        for (const viewer of [STRANGER, undefined]) {
            sessionDid = viewer;
            expect(await open("open")).toBe("shown");
        }
    });
});

describe("group labels: Crew and custom groups for admins and moderators only", () => {
    const groupsOf = (members: { userDid: string; userGroups?: string[] }[], did: string) =>
        members.find((m) => m.userDid === did)?.userGroups;

    test("a stranger and a logged-out visitor see only admins/moderators/members labels", async () => {
        for (const viewer of [STRANGER, undefined]) {
            const members = await getMembersWithMetrics(viewer, OPEN_ID);
            expect(groupsOf(members, FAN)).toEqual(["members"]);
            expect(groupsOf(members, ADMIN)).toEqual(["admins", "members"]);
            expect(groupsOf(members, MODERATOR)).toEqual(["moderators", "members"]);
        }
    });

    test("the member themself keeps their own labels", async () => {
        expect(groupsOf(await getMembersWithMetrics(FAN, OPEN_ID), FAN)).toEqual(["members", "crew", "vip-list"]);
    });

    test("admins, moderators and platform admins see every label", async () => {
        for (const viewer of [ADMIN, MODERATOR, PLATFORM_ADMIN]) {
            expect(groupsOf(await getMembersWithMetrics(viewer, OPEN_ID), FAN)).toEqual(["members", "crew", "vip-list"]);
        }
    });
});
