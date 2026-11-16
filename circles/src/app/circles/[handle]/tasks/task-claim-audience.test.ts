// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/task-claim-audience.test.ts"
// Fix first (Tim, 2026-11-15): submitTaskClaimAction checked only circle membership, not the task's
// audience, so a follower who isn't crew could claim a crew-only task by its id. It now checks the
// audience the same way joinShiftTaskAction does (filterTasksForViewer).
// The database is in-memory fakes; the session, permission checks and notifications are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
// createTask writes optional fields as undefined (the real driver stores them as null); the fake
// refuses explicit undefined, so drop them on insert here.
for (const name of ["Tasks", "Posts"] as const) {
    const fake = (fakeDb.module as unknown as Record<string, unknown>)[name] as {
        insertOne: (doc: Record<string, unknown>) => Promise<unknown>;
    };
    fake.insertOne = (doc) =>
        fakeDb.col(name).insertOne(Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined)));
}
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_ID = "64f800000000000000000001";
const SHIFT_ID = "64f8000000000000000000a1";
const AUTHOR = "did:test:author";
const CIRCLE_ADMIN = "did:test:circle-admin";
const CREW = "did:test:crew";
const PENDING = "did:test:pending";
const CONFIRMED = "did:test:confirmed";
const FOLLOWER = "did:test:follower";
const STRANGER = "did:test:stranger";
const PLATFORM_ADMIN = "did:test:platform-admin";
const CREW_ONLY = ["admins", "moderators", "crew"];

const STREET = "Canary Street 12";
const LNG = 18.071234;
const PARTICIPANT_NOTE = "CANARY: door code 4711, side entrance";
const DESCRIPTION = "Welcome guests at the door";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, _circleId: string, feature: unknown) => {
        if (feature === features.tasks.view) return true;
        if (feature === features.tasks.create) return did === AUTHOR || did === CIRCLE_ADMIN;
        if (feature === features.tasks.moderate || feature === features.tasks.assign) return did === CIRCLE_ADMIN;
        return false;
    },
}));
mock.module("@/lib/auth/verification", () => ({
    canPerformRestrictedAction: () => true,
    getRestrictedActionMessage: (action: string) => `You can't ${action} yet.`,
}));
const realNotifications = await import("@/lib/data/notifications");
mock.module("@/lib/data/notifications", () =>
    Object.fromEntries(
        Object.entries(realNotifications).map(([name, value]) => [
            name,
            name.startsWith("notify") ? async () => undefined : value,
        ]),
    ),
);
const realUser = await import("@/lib/data/user");
mock.module("@/lib/data/user", () => ({
    ...realUser,
    getUserByDid: async (did: string) => ({ did, handle: did.split(":").pop(), name: did, circleType: "user" }),
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    // As the real one: _id as a string.
    getCircleByHandle: async (handle: string) => {
        const circle = fakeDb.col("Circles").docs.find((c) => c.handle === handle);
        return circle ? { ...circle, _id: circle._id.toString() } : null;
    },
}));

const { submitTaskClaimAction } = await import("./actions");

const TASK_ID = "64f8000000000000000000b1";
const task = (userGroups: string[]) => ({
    _id: TASK_ID,
    circleId: CIRCLE_ID,
    createdBy: AUTHOR,
    taskType: "outcome",
    title: "Bring a PA",
    stage: "open",
    userGroups,
});

const member = (userDid: string, userGroups: string[]) => ({
    _id: new ObjectId(),
    circleId: CIRCLE_ID,
    userDid,
    userGroups,
});

const seed = (userGroups: string[]) => {
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(CIRCLE_ID),
                did: "did:test:venue",
                handle: "venue",
                name: "Venue",
                circleType: "circle",
                enabledModules: ["tasks"],
            },
        ],
        Members: [
            member(CIRCLE_ADMIN, ["admins", "members"]),
            member(CREW, ["crew", "members"]),
            member(FOLLOWER, ["members"]),
        ],
        Tasks: [{ ...task(userGroups), _id: new ObjectId(TASK_ID) }],
    });
    fakeDb.setAggregateResult("Tasks", [task(userGroups)]);
};

const claims = () =>
    ((fakeDb.col("Tasks").docs[0] as { claims?: { claimantDid: string }[] }).claims ?? []).map((c) => c.claimantDid);

const claimAs = async (did: string) => {
    sessionDid = did;
    return submitTaskClaimAction("venue", TASK_ID);
};

beforeEach(() => {
    sessionDid = undefined;
});

describe("claiming a task checks its audience (2026-11-15)", () => {
    test("a follower who isn't crew can't claim a crew-only task, and nothing is written", async () => {
        seed(CREW_ONLY);
        const result = await claimAs(FOLLOWER);
        expect(result.success).toBe(false);
        expect(result.message).toBe("Task not found");
        expect(claims()).toEqual([]);
    });

    test("a crew member can claim a crew-only task", async () => {
        seed(CREW_ONLY);
        const result = await claimAs(CREW);
        expect(result).toEqual({ success: true, message: "Task claim submitted" });
        expect(claims()).toEqual([CREW]);
    });

    test("a task open to everyone: a follower can claim it, as before", async () => {
        seed(["everyone"]);
        const result = await claimAs(FOLLOWER);
        expect(result).toEqual({ success: true, message: "Task claim submitted" });
        expect(claims()).toEqual([FOLLOWER]);
    });

    test("signed out: refused, nothing written", async () => {
        seed(["everyone"]);
        sessionDid = undefined;
        const result = await submitTaskClaimAction("venue", TASK_ID);
        expect(result.success).toBe(false);
        expect(claims()).toEqual([]);
    });
});
