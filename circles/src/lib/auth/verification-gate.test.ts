// Run: IS_BUILD=true bun test src/lib/auth/verification-gate.test.ts
// Staging round fixes (2026-11-19): tasks.assign and tasks.moderate have needsToBeVerified, so
// isAuthorized refuses them to a profile that isn't verified, whatever the circle's access rules say.
// Kept (Tim). isBlockedOnlyByVerification says when that is the only reason, so the Crew panel and
// the shift page can say "complete your profile". It grants nothing; isAuthorized is unchanged.
// The database is in-memory fakes.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const { isAuthorized, isBlockedOnlyByVerification } = await import("./auth");
const { getShiftModerateProfileNote } = await import("@/components/modules/tasks/shift-task-utils");

const CIRCLE_ID = "64f800000000000000000088";
const CREATOR = "did:test:creator";
const MODERATOR = "did:test:moderator";
const VERIFIED_MOD = "did:test:verified-moderator";
const FOLLOWER = "did:test:follower";

beforeEach(() => {
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(CIRCLE_ID),
                handle: "secret-space",
                circleType: "circle",
                createdBy: CREATOR,
                accessRules: { tasks: { assign: ["admins", "moderators"], moderate: ["admins"] } },
            },
            { _id: new ObjectId(), did: CREATOR, handle: "creator", circleType: "user" },
            { _id: new ObjectId(), did: MODERATOR, handle: "moderator", circleType: "user" },
            {
                _id: new ObjectId(),
                did: VERIFIED_MOD,
                handle: "vmod",
                circleType: "user",
                verificationStatus: "verified",
                isVerified: true,
            },
            { _id: new ObjectId(), did: FOLLOWER, handle: "follower", circleType: "user" },
        ],
        Members: [
            { _id: new ObjectId(), circleId: CIRCLE_ID, userDid: CREATOR, userGroups: ["admins", "members"] },
            { _id: new ObjectId(), circleId: CIRCLE_ID, userDid: MODERATOR, userGroups: ["moderators", "members"] },
            { _id: new ObjectId(), circleId: CIRCLE_ID, userDid: VERIFIED_MOD, userGroups: ["moderators", "members"] },
            { _id: new ObjectId(), circleId: CIRCLE_ID, userDid: FOLLOWER, userGroups: ["members"] },
        ],
    });
});

describe("isAuthorized keeps the verification gate", () => {
    test("an unverified moderator is refused Assign Tasks; a verified one gets it", async () => {
        expect(await isAuthorized(MODERATOR, CIRCLE_ID, features.tasks.assign)).toBe(false);
        expect(await isAuthorized(VERIFIED_MOD, CIRCLE_ID, features.tasks.assign)).toBe(true);
    });

    test("the circle's creator passes the gate unverified, as before", async () => {
        expect(await isAuthorized(CREATOR, CIRCLE_ID, features.tasks.moderate)).toBe(true);
    });

    test("the access rules still decide: Moderate Tasks is admins only here", async () => {
        expect(await isAuthorized(VERIFIED_MOD, CIRCLE_ID, features.tasks.moderate)).toBe(false);
    });

    test("features without the gate are unaffected", async () => {
        expect(await isAuthorized(MODERATOR, CIRCLE_ID, features.tasks.view)).toBe(true);
    });
});

describe("isBlockedOnlyByVerification", () => {
    test("true for an unverified moderator and Assign Tasks", async () => {
        expect(await isBlockedOnlyByVerification(MODERATOR, CIRCLE_ID, features.tasks.assign)).toBe(true);
    });

    test("false when the access rules refuse anyway (Moderate Tasks, follower)", async () => {
        expect(await isBlockedOnlyByVerification(MODERATOR, CIRCLE_ID, features.tasks.moderate)).toBe(false);
        expect(await isBlockedOnlyByVerification(FOLLOWER, CIRCLE_ID, features.tasks.assign)).toBe(false);
    });

    test("false when nothing blocks: verified, the creator, a feature without the gate, signed out", async () => {
        expect(await isBlockedOnlyByVerification(VERIFIED_MOD, CIRCLE_ID, features.tasks.assign)).toBe(false);
        expect(await isBlockedOnlyByVerification(CREATOR, CIRCLE_ID, features.tasks.moderate)).toBe(false);
        expect(await isBlockedOnlyByVerification(MODERATOR, CIRCLE_ID, features.tasks.view)).toBe(false);
        expect(await isBlockedOnlyByVerification(undefined, CIRCLE_ID, features.tasks.assign)).toBe(false);
    });
});

describe("the shift page's note", () => {
    const shift = { taskType: "shift" as const };
    test("shown on a shift when Moderate Tasks is held back only by the profile", () => {
        expect(
            getShiftModerateProfileNote(shift, { canModerate: false, moderateNeedsVerifiedProfile: true }),
        ).toContain("To confirm sign-ups and review attendance, complete your profile");
    });

    test("not shown otherwise", () => {
        expect(
            getShiftModerateProfileNote(shift, { canModerate: true, moderateNeedsVerifiedProfile: true }),
        ).toBeNull();
        expect(getShiftModerateProfileNote(shift, { canModerate: false })).toBeNull();
        expect(
            getShiftModerateProfileNote(
                { taskType: "outcome" },
                { canModerate: false, moderateNeedsVerifiedProfile: true },
            ),
        ).toBeNull();
    });
});
