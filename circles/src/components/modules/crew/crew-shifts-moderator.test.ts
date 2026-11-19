// Run: IS_BUILD=true bun test src/components/modules/crew/crew-shifts-moderator.test.ts
// Staging round fixes (2026-11-19): on staging, Hello Peer, a Moderator of The Secret Space, saw the
// Crew page's "Shifts & tasks" panel with only the crew view and no "Review sign-ups"
// (getCrewShiftsAndTasksAction gave isOrganiser = false). The circle's access rules tick Moderators
// for Assign Tasks; Moderate Tasks is admins only.
// crew-shifts-action.test.ts replaces isAuthorized with a fake that reads only the member's groups,
// so it never saw the real check's other condition: tasks.assign and tasks.moderate have
// needsToBeVerified, and isAuthorized refuses those to a profile that isn't verified (picture, About
// text and the Community Guidelines). Here the real isAuthorized runs against the real setup: the
// circle's stored access rules, the moderator's groups ["moderators", "members"], a profile not
// verified. Only the session is stubbed; the database is in-memory fakes.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_ID = "64f800000000000000000077";
const EVENT_ID = "64f8000000000000000000c1";
const SHIFT_ID = "64f8000000000000000000c2";

const ADMIN = "did:test:admin";
const MODERATOR = "did:test:hello-peer";
const C1 = "did:test:c1";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCircleByHandle: async (handle: string) => {
        const circle = fakeDb.col("Circles").docs.find((c) => c.handle === handle);
        return circle ? { ...circle, _id: circle._id.toString() } : null;
    },
}));

const { getCrewShiftsAndTasksAction } = await import("./actions");

const DAY = 86_400_000;
const future = (days: number) => new Date(Date.now() + days * DAY);
const joined = new Date(Date.now() - 2 * DAY);

// What the Access rules page stores for this circle: Moderators ticked for Assign Tasks, Moderate
// Tasks admins only (the form writes every feature of every enabled module).
const SECRET_SPACE_TASK_RULES = {
    view: ["admins", "moderators", "members", "everyone"],
    update: ["admins", "moderators"],
    create: ["admins", "moderators"],
    review: ["admins", "moderators"],
    assign: ["admins", "moderators"],
    resolve: ["admins", "moderators"],
    moderate: ["admins"],
    comment: ["admins", "moderators", "members", "everyone"],
    rank: ["admins", "moderators", "members"],
};

const UNVERIFIED = {};
const VERIFIED = { verificationStatus: "verified", isVerified: true };

const seed = (moderatorProfile: Record<string, unknown>) => {
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(CIRCLE_ID),
                did: "did:test:secret-space",
                handle: "secret-space",
                name: "The Secret Space",
                circleType: "circle",
                createdBy: ADMIN,
                enabledModules: ["crew", "tasks", "shifts", "events"],
                accessRules: { tasks: SECRET_SPACE_TASK_RULES },
            },
            { _id: new ObjectId(), did: ADMIN, handle: "admin", name: "Admin", circleType: "user", ...VERIFIED },
            {
                _id: new ObjectId(),
                did: MODERATOR,
                handle: "hello-peer",
                name: "Hello Peer",
                circleType: "user",
                ...moderatorProfile,
            },
            { _id: new ObjectId(), did: C1, handle: "c1", name: "Cee One", circleType: "user", ...VERIFIED },
        ],
        Members: [
            { _id: new ObjectId(), circleId: CIRCLE_ID, userDid: ADMIN, userGroups: ["admins", "members"] },
            // The follower list shows "Moderator, Follower" ("members" is named Followers).
            { _id: new ObjectId(), circleId: CIRCLE_ID, userDid: MODERATOR, userGroups: ["moderators", "members"] },
            { _id: new ObjectId(), circleId: CIRCLE_ID, userDid: C1, userGroups: ["crew", "members"] },
        ],
        Events: [
            {
                _id: new ObjectId(EVENT_ID),
                circleId: CIRCLE_ID,
                createdBy: ADMIN,
                title: "Show night",
                stage: "open",
                userGroups: ["everyone"],
                startAt: future(10),
                endAt: future(10),
            },
        ],
        Tasks: [
            {
                _id: new ObjectId(SHIFT_ID),
                circleId: CIRCLE_ID,
                createdBy: ADMIN,
                taskType: "shift",
                title: "Door crew",
                stage: "open",
                slots: 2,
                shiftStartTime: "18:00",
                shiftDurationMinutes: 120,
                targetDate: future(10),
                eventId: EVENT_ID,
                userGroups: ["admins", "moderators", "crew"],
                participants: [{ userDid: C1, joinedAt: joined }],
            },
        ],
    });
    fakeDb.setAggregateResult("Tasks", fakeDb.col("Tasks").docs, { applyLeadingMatch: true });
};

const run = async (did: string) => {
    sessionDid = did;
    return getCrewShiftsAndTasksAction("secret-space");
};

describe("Crew page Shifts & tasks: a Moderator with Assign Tasks", () => {
    beforeEach(() => seed(UNVERIFIED));

    test("not verified: the crew view, no names, and the flag that asks for a complete profile", async () => {
        const result = await run(MODERATOR);
        expect(result.show).toBe(true);
        expect(result.isOrganiser).toBe(false);
        expect(result.allByEvent).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain("Cee One");
        expect(result.organiserNeedsVerifiedProfile).toBe(true);
    });

    test("verified: the organiser view, no flag", async () => {
        seed(VERIFIED);
        const result = await run(MODERATOR);
        expect(result.isOrganiser).toBe(true);
        expect(result.allByEvent?.flatMap((g) => g.shifts.map((s) => s.title))).toContain("Door crew");
        expect(result.organiserNeedsVerifiedProfile).toBeUndefined();
    });

    test("crew: the crew view, no flag", async () => {
        const result = await run(C1);
        expect(result.show).toBe(true);
        expect(result.isOrganiser).toBe(false);
        expect(result.allByEvent).toBeUndefined();
        expect(result.organiserNeedsVerifiedProfile).toBeUndefined();
    });

    test("Moderators unticked for Assign Tasks: the crew view and no flag, verified or not", async () => {
        const untick = () => {
            const circle = fakeDb.col("Circles").docs.find((c) => c.handle === "secret-space")!;
            circle.accessRules = { tasks: { ...SECRET_SPACE_TASK_RULES, assign: ["admins"] } };
        };
        untick();
        const unverified = await run(MODERATOR);
        expect(unverified.isOrganiser).toBe(false);
        expect(unverified.organiserNeedsVerifiedProfile).toBeUndefined();
        seed(VERIFIED);
        untick();
        const verified = await run(MODERATOR);
        expect(verified.isOrganiser).toBe(false);
        expect(verified.organiserNeedsVerifiedProfile).toBeUndefined();
    });
});
