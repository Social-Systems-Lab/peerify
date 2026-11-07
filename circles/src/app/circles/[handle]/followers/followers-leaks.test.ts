// Run: IS_BUILD=true bun test "src/app/circles/[handle]/followers/followers-leaks.test.ts"
// Leak round 3, M2 (the part that changes no default, 2026-11-07):
// - The followers page had no server-side check of the circle's "View followers" rule; only the
//   route guard (/api/access) enforced it.
// - The follower list sends each member's groups, so a Crew member who chose crewVisible: false
//   (hidden from Crew peers) was still listed with the "crew" group.
// The circle's admins/moderators, platform admins and the member themself still see everything.
// Since 2026-11-07 (privacy by default) the list itself is for the circle's admins and moderators
// only: followers-count-only.test.ts. The database is in-memory fakes; the session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const BAND_ID = "64f000000000000000000001";
const ADMIN = "did:test:admin";
const MODERATOR = "did:test:moderator";
const HIDDEN_CREW = "did:test:hidden-crew";
const OPEN_CREW = "did:test:open-crew";
const FAN = "did:test:fan";
const STRANGER = "did:test:stranger";
const PLATFORM_ADMIN = "did:test:platform-admin";

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
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCircleByHandle: async (handle: string) => fakeDb.col("Circles").docs.find((c) => c.handle === handle) ?? null,
}));

const { default: FollowersPage } = await import("./page");
const { getMembersWithMetrics } = await import("@/lib/data/member");

const person = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: did,
    circleType: "user",
    ...extra,
});
const row = (userDid: string, userGroups: string[]) => ({
    _id: userDid,
    userDid,
    circleId: BAND_ID,
    userGroups,
    name: userDid,
    handle: userDid.split(":").pop(),
    joinedAt: new Date("2026-10-01"),
});

const seed = (followersRule?: string[]) => {
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(BAND_ID),
                did: "did:test:band",
                handle: "band",
                name: "Band",
                circleType: "circle",
                isPublic: true, // open to follow (approval-required circles: followers-leaks-d2.test.ts)
                ...(followersRule ? { accessRules: { followers: { view: followersRule } } } : {}),
            },
            person(ADMIN),
            person(MODERATOR),
            person(HIDDEN_CREW),
            person(OPEN_CREW),
            person(FAN),
            person(STRANGER),
            person(PLATFORM_ADMIN, { isAdmin: true }),
        ],
        Members: [
            { userDid: ADMIN, circleId: BAND_ID, userGroups: ["admins", "members"] },
            { userDid: MODERATOR, circleId: BAND_ID, userGroups: ["moderators", "members"] },
            { userDid: HIDDEN_CREW, circleId: BAND_ID, userGroups: ["members", "crew"], crewVisible: false },
            { userDid: OPEN_CREW, circleId: BAND_ID, userGroups: ["members", "crew"] },
            { userDid: FAN, circleId: BAND_ID, userGroups: ["members"] },
        ],
    });
    // getMembers' aggregate output (members joined with their profiles).
    fakeDb.setAggregateResult("Members", [
        row(ADMIN, ["admins", "members"]),
        row(MODERATOR, ["moderators", "members"]),
        row(HIDDEN_CREW, ["members", "crew"]),
        row(OPEN_CREW, ["members", "crew"]),
        row(FAN, ["members"]),
    ]);
};

beforeEach(() => {
    sessionDid = undefined;
    seed();
});

const groupsOf = (members: { userDid: string; userGroups?: string[] }[], did: string) =>
    members.find((m) => m.userDid === did)?.userGroups;

describe("follower list: a hidden Crew member's group", () => {
    test("a fan, a signed-in stranger and a logged-out visitor don't see the hidden member's crew group", async () => {
        for (const viewer of [FAN, STRANGER, undefined]) {
            const members = await getMembersWithMetrics(viewer, BAND_ID);
            expect(groupsOf(members, HIDDEN_CREW)).toEqual(["members"]);
            // Since D2, Crew labels are for admins/moderators only, hidden or not.
            expect(groupsOf(members, OPEN_CREW)).toEqual(["members"]);
            expect(members.map((m) => m.userDid)).toContain(HIDDEN_CREW); // still a follower
        }
    });

    test("another Crew member doesn't either (the rail hides them from Crew peers)", async () => {
        expect(groupsOf(await getMembersWithMetrics(OPEN_CREW, BAND_ID), HIDDEN_CREW)).toEqual(["members"]);
    });

    test("admins, moderators, platform admins and the member themself still see it", async () => {
        for (const viewer of [ADMIN, MODERATOR, PLATFORM_ADMIN, HIDDEN_CREW]) {
            expect(groupsOf(await getMembersWithMetrics(viewer, BAND_ID), HIDDEN_CREW)).toEqual(["members", "crew"]);
        }
    });
});

describe("followers page: the circle's View followers rule, server-side", () => {
    const open = async () => {
        try {
            await FollowersPage({ params: Promise.resolve({ handle: "band" }), searchParams: Promise.resolve({}) });
            return "shown";
        } catch (error) {
            if (error instanceof Redirect) return error.url;
            throw error;
        }
    };

    test("rule = members only: a stranger and a logged-out visitor are turned away", async () => {
        seed(["admins", "moderators", "members"]);
        for (const viewer of [STRANGER, undefined]) {
            sessionDid = viewer;
            expect(await open()).toContain("/circles/band/access-denied");
        }
    });

    test("rule = members only: an admin and a moderator get the page, a follower doesn't (managers only since 2026-11-07)", async () => {
        seed(["admins", "moderators", "members"]);
        for (const viewer of [ADMIN, MODERATOR]) {
            sessionDid = viewer;
            expect(await open()).toBe("shown");
        }
        sessionDid = FAN;
        expect(await open()).toContain("/circles/band/access-denied");
    });

    test("rule = admins only: a moderator is turned away, an admin isn't", async () => {
        seed(["admins"]);
        sessionDid = MODERATOR;
        expect(await open()).toContain("/circles/band/access-denied");
        sessionDid = ADMIN;
        expect(await open()).toBe("shown");
    });

    test("default rule (everyone) no longer opens the list: a logged-out visitor is turned away", async () => {
        expect(await open()).toContain("/circles/band/access-denied");
    });
});
