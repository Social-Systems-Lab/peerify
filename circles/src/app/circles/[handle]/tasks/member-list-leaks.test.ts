// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/member-list-leaks.test.ts"
// Leak round 3, H6 (2026-11-05): getMembersAction in tasks, issues and goals required only a login and
// then returned getMembers(circleId) for ANY circle id: names, handles, descriptions, city, joinedAt
// and userGroups (which shows Crew, admins and custom groups), also for approval-required and draft
// circles. The list exists for the assign dialog, so now only people with tasks.assign / issues.assign
// on that circle get it; anyone else gets an empty list. The goals copy had no caller and is removed.
// The database is in-memory fakes; the session and permission checks are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const PRIVATE_CIRCLE_ID = "64e000000000000000000001";
const STRANGER = "did:test:stranger";
const ASSIGNER = "did:test:assigner";
const CANARY_MEMBER = "did:test:canary-member";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) =>
        did === ASSIGNER &&
        circleId === PRIVATE_CIRCLE_ID &&
        (feature === features.tasks.assign || feature === features.issues.assign),
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
mock.module("@/lib/data/storage", () => ({
    saveFile: async () => ({}),
    deleteFile: async () => undefined,
    isFile: () => false,
}));

const tasks = await import("./actions");
const issues = await import("../issues/actions");
const goals = await import("../goals/actions");

const userCircle = (did: string, handle: string) => ({ _id: new ObjectId(), did, handle, name: handle, circleType: "user" });

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(PRIVATE_CIRCLE_ID), did: "did:test:private", handle: "private", circleType: "circle" },
            userCircle(STRANGER, "stranger"),
            userCircle(ASSIGNER, "assigner"),
            userCircle(CANARY_MEMBER, "canary-member"),
        ],
    });
    // getMembers' aggregate: one crew member of the private circle.
    fakeDb.setAggregateResult("Members", [
        {
            _id: "m1",
            userDid: CANARY_MEMBER,
            circleId: PRIVATE_CIRCLE_ID,
            userGroups: ["members", "crew"],
            name: "Canary Member",
            handle: "canary-member",
            did: CANARY_MEMBER,
            circleType: "user",
        },
    ]);
});

const handles = (result: unknown) => (Array.isArray(result) ? result.map((m) => m.handle) : result);

describe("getMembersAction (tasks and issues assign dialogs)", () => {
    test("a signed-in stranger gets an empty list for any circle", async () => {
        sessionDid = STRANGER;
        expect(await tasks.getMembersAction(PRIVATE_CIRCLE_ID)).toEqual([]);
        expect(await issues.getMembersAction(PRIVATE_CIRCLE_ID)).toEqual([]);
    });

    test("someone who may assign in that circle still gets the members", async () => {
        sessionDid = ASSIGNER;
        expect(handles(await tasks.getMembersAction(PRIVATE_CIRCLE_ID))).toEqual(["canary-member"]);
        expect(handles(await issues.getMembersAction(PRIVATE_CIRCLE_ID))).toEqual(["canary-member"]);
    });

    test("logged out: not authenticated", async () => {
        expect(await tasks.getMembersAction(PRIVATE_CIRCLE_ID)).toEqual({
            success: false,
            message: "User not authenticated",
        });
    });

    test("the goals copy, which no page used, is gone", () => {
        expect("getMembersAction" in goals).toBe(false);
    });
});
