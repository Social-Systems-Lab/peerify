// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/timeline-pending-flag.test.ts"
// Staging round fixes 4 (2026-11-19), F3: getTasksAction says whether the viewer may see shift
// pending counts (showsShiftPendingCounts), so the circle Events timeline prints "N pending" for
// organisers only, as the event crew panel does: Assign or Moderate Tasks, or a platform admin.
// The real isAuthorized runs (verification gate included); only the session is stubbed; the
// database is in-memory fakes.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_ID = "64f800000000000000000099";
const ADMIN = "did:test:admin";
const MODERATOR = "did:test:moderator";
const CREW = "did:test:crew";
const PLATFORM_ADMIN = "did:test:platform-admin";

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

const { getTasksAction } = await import("./actions");

const VERIFIED = { verificationStatus: "verified", isVerified: true };
const person = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: did,
    circleType: "user",
    ...VERIFIED,
    ...extra,
});

beforeEach(() => {
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(CIRCLE_ID),
                did: "did:test:secret-space",
                handle: "secret-space",
                circleType: "circle",
                createdBy: ADMIN,
                enabledModules: ["crew", "tasks", "shifts", "events"],
                accessRules: { tasks: { assign: ["admins", "moderators"], moderate: ["admins"] } },
            },
            person(ADMIN),
            person(MODERATOR),
            person(CREW),
            person(PLATFORM_ADMIN, { isAdmin: true }),
        ],
        Members: [
            { _id: new ObjectId(), circleId: CIRCLE_ID, userDid: ADMIN, userGroups: ["admins", "members"] },
            { _id: new ObjectId(), circleId: CIRCLE_ID, userDid: MODERATOR, userGroups: ["moderators", "members"] },
            { _id: new ObjectId(), circleId: CIRCLE_ID, userDid: CREW, userGroups: ["crew", "members"] },
        ],
        Tasks: [],
    });
    fakeDb.setAggregateResult("Tasks", [], { applyLeadingMatch: true });
});

const flagFor = async (did: string) => {
    sessionDid = did;
    return (await getTasksAction("secret-space")).showsShiftPendingCounts;
};

describe("getTasksAction: showsShiftPendingCounts", () => {
    test("crew: false", async () => {
        expect(await flagFor(CREW)).toBe(false);
    });
    test("a moderator with Assign Tasks, an admin, a platform admin: true", async () => {
        expect(await flagFor(MODERATOR)).toBe(true);
        expect(await flagFor(ADMIN)).toBe(true);
        expect(await flagFor(PLATFORM_ADMIN)).toBe(true);
    });
});
