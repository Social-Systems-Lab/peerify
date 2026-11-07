// Run: IS_BUILD=true bun test "src/app/circles/[handle]/followers/followers-count-only.test.ts"
// Tim's decision 2026-11-07 (UX month, privacy by default), replacing D2's "open circles stay
// public": for every circle (personal, artist, venue, other), people who aren't its admins or
// moderators, logged-out visitors too, see only the follower COUNT. The follower list, the
// Followers tab and the follower links are for:
// - a personal profile: its owner only;
// - any other circle: its admins and moderators (moderators subject to the circle's own "View
//   followers" rule, which can narrow but no longer widen), and platform admins, as before.
// Someone with a pending admin invitation may open the page for its accept banner, without the list.
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
const FAN = "did:test:fan"; // follows everything, Crew in both bands
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
    fakeDb.setAggregateResult("Members", [
        row(ADMIN, OPEN_ID, ["admins", "members"]),
        row(MODERATOR, OPEN_ID, ["moderators", "members"]),
        row(FAN, OPEN_ID, ["members", "crew", "vip-list"]),
    ]);
});

// "denied", or the page's MembersModule element (its props say whether the list is rendered).
const open = async (handle: string): Promise<"denied" | { props: { showList?: boolean } }> => {
    try {
        return (await FollowersPage({ params: Promise.resolve({ handle }), searchParams: Promise.resolve({}) })) as any;
    } catch (error) {
        if (error instanceof Redirect) return "denied";
        throw error;
    }
};
const listShown = async (handle: string) => {
    const result = await open(handle);
    return result !== "denied" && result.props.showList === true;
};

describe("a personal profile's follower list: owner only (unchanged from D2)", () => {
    test("the owner sees it", async () => {
        sessionDid = OWNER;
        expect(await listShown("owner")).toBe(true);
    });

    test("a follower, a stranger, a platform admin and a logged-out visitor don't", async () => {
        for (const viewer of [FAN, STRANGER, PLATFORM_ADMIN, undefined]) {
            sessionDid = viewer;
            expect(await open("owner")).toBe("denied");
        }
    });
});

describe("artist, venue and other circles, open or approval-required: admins and moderators only", () => {
    test("an admin, a moderator and a platform admin see the list", async () => {
        for (const handle of ["open", "closed"]) {
            for (const viewer of [ADMIN, MODERATOR, PLATFORM_ADMIN]) {
                sessionDid = viewer;
                expect(await listShown(handle)).toBe(true);
            }
        }
    });

    test("a follower (also Crew), a stranger and a logged-out visitor don't, open circles included", async () => {
        for (const handle of ["open", "closed"]) {
            for (const viewer of [FAN, STRANGER, undefined]) {
                sessionDid = viewer;
                expect(await open(handle)).toBe("denied");
            }
        }
    });

    test("a pending admin invitee gets the page for the accept banner, without the list", async () => {
        sessionDid = INVITEE;
        const result = await open("closed");
        expect(result).not.toBe("denied");
        expect(result !== "denied" && result.props.showList).toBe(false);
        expect(await open("open")).toBe("denied"); // no invitation there
    });
});

describe("the Followers tab and follower links (count only for everyone else)", () => {
    const membership = (circleId: string, userGroups: string[]) => [{ circleId, userGroups }];
    const band = { _id: OPEN_ID, circleType: "circle" as const, did: "did:test:open" };
    const profile = { _id: PERSON_ID, circleType: "user" as const, did: OWNER };

    test("shown to the circle's admins, moderators and platform admins", () => {
        expect(canSeeFollowersLink(band, { did: ADMIN, memberships: membership(OPEN_ID, ["admins"]) })).toBe(true);
        expect(canSeeFollowersLink(band, { did: MODERATOR, memberships: membership(OPEN_ID, ["moderators"]) })).toBe(true);
        expect(canSeeFollowersLink(band, { did: PLATFORM_ADMIN, isAdmin: true, memberships: [] })).toBe(true);
    });

    test("hidden for a follower, a Crew member, a stranger and a logged-out visitor", () => {
        expect(canSeeFollowersLink(band, { did: FAN, memberships: membership(OPEN_ID, ["members", "crew"]) })).toBe(false);
        expect(canSeeFollowersLink(band, { did: STRANGER, memberships: [] })).toBe(false);
        expect(canSeeFollowersLink(band, undefined)).toBe(false);
    });

    test("a personal profile: its owner only", () => {
        expect(canSeeFollowersLink(profile, { did: OWNER, memberships: [] })).toBe(true);
        expect(canSeeFollowersLink(profile, { did: PLATFORM_ADMIN, isAdmin: true, memberships: [] })).toBe(false);
        expect(canSeeFollowersLink(profile, { did: FAN, memberships: membership(PERSON_ID, ["members"]) })).toBe(false);
    });
});

describe("the event invite picker for an event: people who may invite keep it", () => {
    const EVENT_ID = "64f7000000000000000000e1";
    const OTHER_EVENT_ID = "64f7000000000000000000e2";
    beforeEach(() => {
        // getEventById's aggregate output: FAN created an event in the open band.
        fakeDb.setAggregateResult("Events", [
            { _id: EVENT_ID, circleId: OPEN_ID, title: "Fan's show", stage: "open", createdBy: FAN },
        ]);
    });

    test("the event's creator (a plain follower) gets the follower rows for their event", async () => {
        sessionDid = FAN;
        expect((await getCircleMembersAction("open", EVENT_ID)).members.length).toBeGreaterThan(0);
    });

    test("a stranger who didn't create it gets nothing, with or without the event", async () => {
        sessionDid = STRANGER;
        expect((await getCircleMembersAction("open", EVENT_ID)).members).toEqual([]);
    });

    test("an event of another circle doesn't open this circle's list", async () => {
        fakeDb.setAggregateResult("Events", [
            { _id: OTHER_EVENT_ID, circleId: CLOSED_ID, title: "Other", stage: "open", createdBy: FAN },
        ]);
        sessionDid = FAN;
        expect((await getCircleMembersAction("open", OTHER_EVENT_ID)).members).toEqual([]);
    });
});

describe("the event invite picker without an event", () => {
    test("a follower and a stranger get no follower rows; an admin does", async () => {
        for (const viewer of [FAN, STRANGER]) {
            sessionDid = viewer;
            expect((await getCircleMembersAction("open")).members).toEqual([]);
        }
        sessionDid = ADMIN;
        expect((await getCircleMembersAction("open")).members.length).toBeGreaterThan(0);
    });
});

describe("group labels: for the circle's admins and moderators only", () => {
    const groupsOf = (members: { userDid: string; userGroups?: string[] }[], did: string) =>
        members.find((m) => m.userDid === did)?.userGroups;

    test("anyone else (a follower, a stranger, logged out) gets no Admin, Moderator, Crew or custom label", async () => {
        for (const viewer of [STRANGER, undefined]) {
            const members = await getMembersWithMetrics(viewer, OPEN_ID);
            expect(groupsOf(members, ADMIN)).toEqual(["members"]);
            expect(groupsOf(members, MODERATOR)).toEqual(["members"]);
            expect(groupsOf(members, FAN)).toEqual(["members"]);
        }
        expect(groupsOf(await getMembersWithMetrics(FAN, OPEN_ID), ADMIN)).toEqual(["members"]);
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
