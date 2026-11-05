// Run: IS_BUILD=true bun test "src/app/circles/[handle]/issues/cross-circle.test.ts"
// Leak round 3, containment C4 (2026-11-05): issues and goals by id. Before the fix, the actions
// loaded an issue or goal by _id alone and checked permissions on the circle in the URL, so any
// signed-in user could read, edit, re-stage or delete any issue or goal on the platform by passing
// their own handle. Locations (Exact by default) also reached every viewer. The database is
// in-memory fakes (testing/fake-db.ts) and the session/permission checks are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const VENUE_ID = "64a000000000000000000a02";
const MINE_ID = "64a000000000000000000a03";
const OWNER = "did:test:owner";
const STRANGER = "did:test:stranger";
const MEMBER = "did:test:member";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) => {
        if (!did) return false;
        // Every signed-in user may view issues and goals everywhere (the default rule).
        if (feature === features.issues.view || feature === features.goals.view) return true;
        // Everything else: the stranger manages their own profile circle, the owner the venue.
        return (did === STRANGER && circleId === MINE_ID) || (did === OWNER && circleId === VENUE_ID);
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
mock.module("@/lib/data/storage", () => ({
    saveFile: async () => ({}),
    deleteFile: async () => undefined,
    isFile: () => false,
}));

const { getIssueAction, getIssuesAction, deleteIssueAction, ensureShadowPostForIssueAction } = await import(
    "./actions"
);
const { getGoalAction, changeGoalStageAction } = await import("../goals/actions");

const STREET = "Canary Issue Street 12";
const LNG = 18.071234;
const ISSUE_ID = "64a0000000000000000001a1";
const GOAL_ID = "64a0000000000000000001b1";

const located = () => ({ precision: 4, city: "Stockholm", street: STREET, lngLat: { lng: LNG, lat: 59.3 } });
const issue = () => ({
    _id: new ObjectId(ISSUE_ID),
    circleId: VENUE_ID,
    createdBy: OWNER,
    title: "Broken stage light",
    stage: "open",
    location: located(),
    userGroups: [],
});
const goal = () => ({
    _id: new ObjectId(GOAL_ID),
    circleId: VENUE_ID,
    createdBy: OWNER,
    title: "New PA",
    stage: "open",
    location: located(),
    userGroups: [],
});
const leaksLocation = (value: unknown) => {
    const t = JSON.stringify(value) ?? "";
    return t.includes(STREET) || t.includes(String(LNG));
};

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(VENUE_ID), did: "did:test:venue", handle: "venue", name: "Venue", circleType: "circle" },
            { _id: new ObjectId(MINE_ID), did: STRANGER, handle: "mine", name: "Stranger", circleType: "user" },
        ],
        Issues: [issue()],
        Goals: [goal()],
        Feeds: [
            { _id: new ObjectId(), circleId: MINE_ID, handle: "default" },
            { _id: new ObjectId(), circleId: VENUE_ID, handle: "default" },
        ],
    });
    // getIssueById/getGoalById are aggregations; their leading $match ({ _id, circleId }) applies.
    fakeDb.setAggregateResult("Issues", [issue()], { applyLeadingMatch: true });
    fakeDb.setAggregateResult("Goals", [goal()], { applyLeadingMatch: true });
});

describe("cross-circle reads", () => {
    test("a stranger can't read another circle's issue through their own handle", async () => {
        sessionDid = STRANGER;
        expect(await getIssueAction("mine", ISSUE_ID)).toBeNull();
    });

    test("a stranger can't read another circle's goal through their own handle", async () => {
        sessionDid = STRANGER;
        expect(await getGoalAction("mine", GOAL_ID)).toBeNull();
    });

    test("the issue still loads through its own circle", async () => {
        sessionDid = OWNER;
        expect((await getIssueAction("venue", ISSUE_ID))?.title).toBe("Broken stage light");
    });
});

describe("cross-circle writes", () => {
    test("a stranger can't delete another circle's issue through their own handle", async () => {
        sessionDid = STRANGER;
        const result = await deleteIssueAction("mine", ISSUE_ID);

        expect(result.success).toBe(false);
        expect(fakeDb.col("Issues").docs).toHaveLength(1);
    });

    test("a stranger can't change another circle's goal stage through their own handle", async () => {
        sessionDid = STRANGER;
        const result = await changeGoalStageAction("mine", GOAL_ID, "completed" as any);

        expect(result.success).toBe(false);
        expect(fakeDb.col("Goals").docs[0].stage).toBe("open");
    });

    test("a stranger can't copy another circle's issue title into their own feed", async () => {
        sessionDid = STRANGER;
        expect(await ensureShadowPostForIssueAction(ISSUE_ID, MINE_ID)).toBeNull();
        expect(fakeDb.col("Posts").docs).toHaveLength(0);
    });

    test("logged out, no shadow post is created", async () => {
        expect(await ensureShadowPostForIssueAction(ISSUE_ID, VENUE_ID)).toBeNull();
        expect(fakeDb.col("Posts").docs).toHaveLength(0);
    });
});

describe("issue and goal locations", () => {
    test("a member who may view issues gets city level, no street or pin", async () => {
        sessionDid = MEMBER;
        const one = await getIssueAction("venue", ISSUE_ID);
        const list = await getIssuesAction("venue");
        const goalOne = await getGoalAction("venue", GOAL_ID);

        expect(one?.location?.city).toBe("Stockholm");
        expect(leaksLocation([one, list, goalOne])).toBe(false);
    });

    test("the author keeps the stored location", async () => {
        sessionDid = OWNER;
        expect(leaksLocation(await getIssueAction("venue", ISSUE_ID))).toBe(true);
    });
});
