// Run: IS_BUILD=true bun test src/lib/data/crew-review.test.ts
// Crew applications on the Crew Dashboard (2026-11-06):
//  - the pending list (Dashboard) and the count (badge on the Crew Dashboard button) reach only
//    people who may manage Crew applications; everyone else sees neither;
//  - crew_application notifications go only to people who can open the Dashboard (admins by
//    default; moderators can manage applications but can't open /settings), and their Review
//    button and push link open the applications on the Dashboard.
// The database is in-memory fakes (testing/fake-db.ts); nothing real is touched.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const ARTIST_ID = "64a000000000000000000c01";
const OTHER_ID = "64a000000000000000000c02";
const ADMIN = "did:test:admin";
const MODERATOR = "did:test:moderator";
const FAN = "did:test:fan";

// Default rules: manage_crew_applications = admins + moderators; settings.edit_about = admins.
const groups: Record<string, string[]> = { [ADMIN]: ["admins"], [MODERATOR]: ["moderators"], [FAN]: ["members"] };
const allowed: Record<string, string[]> = {
    manage_crew_applications: ["admins", "moderators"],
    edit_about: ["admins"],
};
let viewerDid: string | undefined;

const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => viewerDid,
    isAuthorized: async (did: string | undefined, circleId: string, feature: { handle: string }) =>
        !!did && circleId === ARTIST_ID && (groups[did] ?? []).some((g) => allowed[feature.handle]?.includes(g)),
    // Members whose group the feature allows, as identity circles (what the real one returns).
    getAuthorizedMembers: async (_circle: unknown, feature: { handle: string }) =>
        Object.keys(groups)
            .filter((did) => groups[did].some((g) => allowed[feature.handle]?.includes(g)))
            .map((did) => ({ did, handle: did.split(":").pop() })),
}));

const { getCrewApplicationReviewers, getPendingCrewApplicationCountForViewer } = await import("./crew-review");
const { getAllCrewApplicationsAction } = await import("@/components/modules/crew-applications/actions");
const { getCrewApplicationsReviewPath } = await import("@/lib/utils/crew-paths");
const { resolvePushUrl } = await import("./push");

// What getAllCrewApplications' aggregate returns after its $lookup/$project (no email).
const application = (n: number, circleId: string, status: string) => ({
    _id: `64a00000000000000000a00${n}`,
    userDid: `did:test:applicant${n}`,
    circleId,
    status,
    requestedAt: new Date(`2026-11-0${n}T10:00:00Z`),
    message: "I can drive the van",
    name: `Applicant ${n}`,
    handle: `applicant${n}`,
});

beforeEach(() => {
    fakeDb.reset();
    viewerDid = undefined;
    fakeDb.setAggregateResult(
        "CrewApplications",
        [
            application(1, ARTIST_ID, "pending"),
            application(2, ARTIST_ID, "pending"),
            application(3, ARTIST_ID, "rejected"),
            application(4, ARTIST_ID, "approved"),
            application(5, OTHER_ID, "pending"),
        ],
        { applyLeadingMatch: true },
    );
});

describe("Crew Dashboard: pending applications list", () => {
    test("a manager gets this circle's pending applications, nothing else", async () => {
        viewerDid = ADMIN;
        const result = await getAllCrewApplicationsAction(ARTIST_ID);
        expect(result.success).toBe(true);
        expect(result.pendingApplications?.map((a) => a.name)).toEqual(["Applicant 1", "Applicant 2"]);
        expect(JSON.stringify(result)).not.toContain("@");
    });

    test("a member who can't manage applications gets no list", async () => {
        viewerDid = FAN;
        const result = await getAllCrewApplicationsAction(ARTIST_ID);
        expect(result.success).toBe(false);
        expect(result.pendingApplications).toBeUndefined();
    });

    test("logged out: no list", async () => {
        const result = await getAllCrewApplicationsAction(ARTIST_ID);
        expect(result.success).toBe(false);
        expect(result.pendingApplications).toBeUndefined();
    });
});

describe("Crew Dashboard button: pending count badge", () => {
    test("a manager sees the count of pending applications for this circle", async () => {
        expect(await getPendingCrewApplicationCountForViewer(ADMIN, ARTIST_ID)).toBe(2);
    });

    test("a member, a stranger and a logged-out visitor get 0", async () => {
        expect(await getPendingCrewApplicationCountForViewer(FAN, ARTIST_ID)).toBe(0);
        expect(await getPendingCrewApplicationCountForViewer("did:test:stranger", ARTIST_ID)).toBe(0);
        expect(await getPendingCrewApplicationCountForViewer(undefined, ARTIST_ID)).toBe(0);
    });

    test("a manager of another circle gets 0 here", async () => {
        expect(await getPendingCrewApplicationCountForViewer(ADMIN, OTHER_ID)).toBe(0);
    });
});

describe("crew_application notification: who gets it, where Review goes", () => {
    test("only people who can open the Crew Dashboard are notified (admins, not moderators or members)", async () => {
        const reviewers = await getCrewApplicationReviewers({ _id: ARTIST_ID, handle: "artist" } as any);
        expect(reviewers.map((r) => r.did)).toEqual([ADMIN]);
    });

    test("Review and the push link open the applications on the Crew Dashboard", () => {
        expect(getCrewApplicationsReviewPath("artist")).toBe("/circles/artist/settings/crew#applications");
        expect(resolvePushUrl("crew_application", { circle: { handle: "artist" } })).toBe(
            "/circles/artist/settings/crew#applications",
        );
    });
});
