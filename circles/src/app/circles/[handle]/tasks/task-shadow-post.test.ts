// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/task-shadow-post.test.ts"
// Fix first (Tim, 2026-11-15): ensureShadowPostForTaskAction (the hidden comment post behind a task
// or shift page) is a server action, but had no sign-in check and didn't check that the task
// belongs to the circle passed in, so a direct call could post a crew-only task's title into
// another circle's feed. It now needs sign-in, a task of that circle, and a viewer who can see it.
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

const { ensureShadowPostForTaskAction } = await import("./actions");

const TASK_ID = "64f8000000000000000000c1";
const OTHER_CIRCLE_ID = "64f800000000000000000002";
const FEED_ID = "64f8000000000000000000f1";
const OTHER_FEED_ID = "64f8000000000000000000f2";
const TITLE = "CANARY crew-only task title";

const task = (userGroups: string[]) => ({
    _id: new ObjectId(TASK_ID),
    circleId: CIRCLE_ID,
    createdBy: AUTHOR,
    taskType: "outcome",
    title: TITLE,
    stage: "open",
    userGroups,
});

const member = (userDid: string, userGroups: string[], circleId = CIRCLE_ID) => ({
    _id: new ObjectId(),
    circleId,
    userDid,
    userGroups,
});

const seed = (userGroups: string[]) => {
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(CIRCLE_ID), did: "did:test:venue", handle: "venue", circleType: "circle" },
            { _id: new ObjectId(OTHER_CIRCLE_ID), did: "did:test:other", handle: "other", circleType: "circle" },
        ],
        Members: [
            member(CIRCLE_ADMIN, ["admins", "members"]),
            member(CREW, ["crew", "members"]),
            member(FOLLOWER, ["members"]),
            member(FOLLOWER, ["admins", "members"], OTHER_CIRCLE_ID),
        ],
        Feeds: [
            { _id: new ObjectId(FEED_ID), circleId: CIRCLE_ID, handle: "default" },
            { _id: new ObjectId(OTHER_FEED_ID), circleId: OTHER_CIRCLE_ID, handle: "default" },
        ],
        Tasks: [task(userGroups)],
        Posts: [],
    });
};

const posts = () => fakeDb.col("Posts").docs as { feedId: string; content: string; userGroups: string[] }[];
const commentPostId = () => (fakeDb.col("Tasks").docs[0] as { commentPostId?: string }).commentPostId;

const ensureAs = async (did: string | undefined, circleId = CIRCLE_ID) => {
    sessionDid = did;
    return ensureShadowPostForTaskAction(TASK_ID, circleId);
};

beforeEach(() => {
    sessionDid = undefined;
});

describe("the shadow comment post: refusals write nothing (2026-11-15)", () => {
    test("signed out", async () => {
        seed(["everyone"]);
        expect(await ensureAs(undefined)).toBeNull();
        expect(posts()).toEqual([]);
        expect(commentPostId()).toBeUndefined();
    });

    test("a task of another circle: no post in that circle's feed", async () => {
        seed(CREW_ONLY);
        // The follower is an admin of the other circle, so passing its id must not help.
        expect(await ensureAs(FOLLOWER, OTHER_CIRCLE_ID)).toBeNull();
        expect(await ensureAs(CREW, OTHER_CIRCLE_ID)).toBeNull();
        expect(posts()).toEqual([]);
        expect(commentPostId()).toBeUndefined();
    });

    test("someone who can't see the task (a follower, on a crew-only task)", async () => {
        seed(CREW_ONLY);
        expect(await ensureAs(FOLLOWER)).toBeNull();
        expect(posts()).toEqual([]);
        expect(commentPostId()).toBeUndefined();
    });

    test("an invalid id", async () => {
        seed(["everyone"]);
        sessionDid = CREW;
        expect(await ensureShadowPostForTaskAction("nope", CIRCLE_ID)).toBeNull();
        expect(posts()).toEqual([]);
    });
});

describe("the normal case still works", () => {
    test("a crew member opening a crew-only task: the post is made in the task's circle, crew-only", async () => {
        seed(CREW_ONLY);
        const id = await ensureAs(CREW);
        expect(typeof id).toBe("string");
        expect(posts()).toHaveLength(1);
        expect(posts()[0].feedId).toBe(FEED_ID);
        expect(posts()[0].userGroups).toEqual(CREW_ONLY);
        expect(commentPostId()).toBe(id!);
        // Second call: returns the same post, makes no new one.
        expect(await ensureAs(CREW)).toBe(id);
        expect(posts()).toHaveLength(1);
    });

    test("a task open to everyone: a follower opening it gets the post", async () => {
        seed(["everyone"]);
        const id = await ensureAs(FOLLOWER);
        expect(typeof id).toBe("string");
        expect(posts()).toHaveLength(1);
        expect(posts()[0].feedId).toBe(FEED_ID);
    });
});
