// Run: IS_BUILD=true bun test "src/app/circles/[handle]/issues/item-visibility.test.ts"
// Leak round 3, M9 (2026-11-07): issues in the "review" stage were hidden from non-reviewers only by
// the list's filter in the browser (Issues.tsx), so getIssuesAction and getIssueAction returned
// them; and an issue's or goal's audience (userGroups) was never checked (TODOs in both actions).
// Now both are enforced on the server. Authors, assignees, moderators and platform admins still
// get everything; goals in review stay visible to everyone, as before. The database is in-memory
// fakes; the session and permission checks are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const VENUE_ID = "64f500000000000000000001";
const AUTHOR = "did:test:author";
const REVIEWER = "did:test:reviewer";
const MODERATOR = "did:test:moderator";
const CREW_MEMBER = "did:test:crew";
const ASSIGNEE = "did:test:assignee";
const STRANGER = "did:test:stranger";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, _circleId: string, feature: unknown) => {
        if (!did) return false;
        if (feature === features.issues.view || feature === features.goals.view) return true;
        if (feature === features.issues.review || feature === features.goals.review) return did === REVIEWER;
        if (feature === features.issues.moderate || feature === features.goals.moderate) return did === MODERATOR;
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
mock.module("@/lib/data/storage", () => ({ saveFile: async () => ({}), deleteFile: async () => undefined, isFile: () => false }));

const { getIssueAction, getIssuesAction } = await import("./actions");
const { getGoalAction, getGoalsAction } = await import("../goals/actions");

const OPEN_ISSUE = "64f5000000000000000001a1";
const REVIEW_ISSUE = "64f5000000000000000001a2";
const CREW_ISSUE = "64f5000000000000000001a3";
const OPEN_GOAL = "64f5000000000000000001b1";
const REVIEW_GOAL = "64f5000000000000000001b2";
const CREW_GOAL = "64f5000000000000000001b3";

const item = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(id),
    circleId: VENUE_ID,
    createdBy: AUTHOR,
    title,
    stage: "open",
    userGroups: [],
    author: { did: AUTHOR },
    ...extra,
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(VENUE_ID), did: "did:test:venue", handle: "venue", name: "Venue", circleType: "circle" },
            ...[AUTHOR, REVIEWER, MODERATOR, CREW_MEMBER, ASSIGNEE, STRANGER].map((did) => ({
                _id: new ObjectId(),
                did,
                handle: did.split(":").pop(),
                circleType: "user",
            })),
        ],
        Members: [{ userDid: CREW_MEMBER, circleId: VENUE_ID, userGroups: ["members", "crew"] }],
    });
    fakeDb.setAggregateResult(
        "Issues",
        [
            item(OPEN_ISSUE, "Open issue"),
            item(REVIEW_ISSUE, "CANARY ISSUE IN REVIEW", { stage: "review" }),
            item(CREW_ISSUE, "CANARY CREW-ONLY ISSUE", { userGroups: ["crew"], assignedTo: ASSIGNEE }),
        ],
        { applyLeadingMatch: true },
    );
    fakeDb.setAggregateResult(
        "Goals",
        [
            item(OPEN_GOAL, "Open goal"),
            item(REVIEW_GOAL, "Goal in review", { stage: "review" }),
            item(CREW_GOAL, "CANARY CREW-ONLY GOAL", { userGroups: ["crew"] }),
        ],
        { applyLeadingMatch: true },
    );
});

const issueTitles = async () => (await getIssuesAction("venue", true, true)).map((i) => i.title).sort();
const goalTitles = async () => (await getGoalsAction("venue", true, true)).goals.map((g) => g.title).sort();

describe("issues", () => {
    test("a signed-in stranger: no issue in review, no crew-only issue (list and by id)", async () => {
        sessionDid = STRANGER;
        expect(await issueTitles()).toEqual(["Open issue"]);
        expect(await getIssueAction("venue", REVIEW_ISSUE)).toBeNull();
        expect(await getIssueAction("venue", CREW_ISSUE)).toBeNull();
        expect((await getIssueAction("venue", OPEN_ISSUE))?.title).toBe("Open issue");
    });

    test("a reviewer gets the issue in review; a crew member the crew-only one", async () => {
        sessionDid = REVIEWER;
        expect(await issueTitles()).toEqual(["CANARY ISSUE IN REVIEW", "Open issue"]);
        sessionDid = CREW_MEMBER;
        expect(await issueTitles()).toEqual(["CANARY CREW-ONLY ISSUE", "Open issue"]);
        expect((await getIssueAction("venue", CREW_ISSUE))?.title).toBe("CANARY CREW-ONLY ISSUE");
    });

    test("the author, the assignee and a moderator keep what they had", async () => {
        sessionDid = AUTHOR;
        expect(await issueTitles()).toEqual(["CANARY CREW-ONLY ISSUE", "CANARY ISSUE IN REVIEW", "Open issue"]);
        sessionDid = MODERATOR;
        expect(await issueTitles()).toEqual(["CANARY CREW-ONLY ISSUE", "CANARY ISSUE IN REVIEW", "Open issue"]);
        sessionDid = ASSIGNEE;
        expect((await getIssueAction("venue", CREW_ISSUE))?.title).toBe("CANARY CREW-ONLY ISSUE");
    });
});

describe("goals", () => {
    test("a signed-in stranger: no crew-only goal; a goal in review stays visible as before", async () => {
        sessionDid = STRANGER;
        expect(await goalTitles()).toEqual(["Goal in review", "Open goal"]);
        expect(await getGoalAction("venue", CREW_GOAL)).toBeNull();
    });

    test("a crew member, the author and a moderator get the crew-only goal", async () => {
        for (const did of [CREW_MEMBER, AUTHOR, MODERATOR]) {
            sessionDid = did;
            expect(await goalTitles()).toContain("CANARY CREW-ONLY GOAL");
            expect((await getGoalAction("venue", CREW_GOAL))?.title).toBe("CANARY CREW-ONLY GOAL");
        }
    });
});
