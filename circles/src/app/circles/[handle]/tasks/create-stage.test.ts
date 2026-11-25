// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/create-stage.test.ts"
// Crew polish (2026-11-25, backlog item 5 widened to tasks): a task or shift made by someone who could
// approve it themselves (Approve tasks, tasks.review: admins and moderators by default, following the
// circle's access rules and the verification gate) starts open, with no review step and no "submitted
// for review" notice. Anyone else's waits for review, as before.
// The real isAuthorized runs against the fake Circles and Members (access rules and verification
// included); only the session, restricted-action check and notifications are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
for (const name of ["Tasks", "Posts"] as const) {
    const fake = (fakeDb.module as unknown as Record<string, unknown>)[name] as {
        insertOne: (doc: Record<string, unknown>) => Promise<unknown>;
    };
    fake.insertOne = (doc) =>
        fakeDb.col(name).insertOne(Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined)));
}
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_ID = "64f800000000000000000c01";
const ADMIN = "did:test:admin";
const MODERATOR = "did:test:moderator";
const UNVERIFIED_MODERATOR = "did:test:unverified-moderator";
const MEMBER = "did:test:member";
const OUTSIDER = "did:test:outsider";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));
const realVerification = await import("@/lib/auth/verification");
mock.module("@/lib/auth/verification", () => ({ ...realVerification, canPerformRestrictedAction: () => true }));
const notified: string[] = [];
const realNotifications = await import("@/lib/data/notifications");
mock.module("@/lib/data/notifications", () =>
    Object.fromEntries(
        Object.entries(realNotifications).map(([name, value]) => [
            name,
            name.startsWith("notify")
                ? async () => {
                      notified.push(name);
                  }
                : value,
        ]),
    ),
);
const realUser = await import("@/lib/data/user");
mock.module("@/lib/data/user", () => ({
    ...realUser,
    getUserByDid: async (did: string) => ({ did, handle: did.split(":").pop(), name: did, circleType: "user" }),
    getUserPrivate: async (did: string) => ({ did, handle: did.split(":").pop(), name: did, circleType: "user" }),
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

const { createTaskAction } = await import("./actions");

const member = (userDid: string, userGroups: string[]) => ({
    _id: new ObjectId(),
    circleId: CIRCLE_ID,
    userDid,
    userGroups,
});
const person = (did: string, verified = true) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    circleType: "user",
    ...(verified ? { verificationStatus: "verified" } : {}),
});

const seed = (accessRules?: Record<string, Record<string, string[]>>) => {
    notified.length = 0;
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(CIRCLE_ID),
                handle: "artist",
                name: "Artist",
                circleType: "circle",
                createdBy: "did:test:creator",
                enabledModules: ["tasks", "shifts"],
                ...(accessRules ? { accessRules } : {}),
            },
            person(ADMIN),
            person(MODERATOR),
            person(UNVERIFIED_MODERATOR, false),
            person(MEMBER),
            person(OUTSIDER),
        ],
        Members: [
            member(ADMIN, ["admins", "members"]),
            member(MODERATOR, ["moderators", "members"]),
            member(UNVERIFIED_MODERATOR, ["moderators", "members"]),
            member(MEMBER, ["members", "crew"]),
        ],
    });
    // getTaskById reads through an aggregate; serve the live documents, matched by id.
    fakeDb.setAggregateResult("Tasks", fakeDb.col("Tasks").docs, { applyLeadingMatch: true });
};

const form = (title: string, taskType: "outcome" | "shift") => {
    const data = new FormData();
    const values: Record<string, string> =
        taskType === "shift"
            ? {
                  title,
                  description: "Help at the door",
                  taskType,
                  slots: "2",
                  shiftStartTime: "18:00",
                  shiftDurationMinutes: "120",
                  targetDate: "2026-12-06",
                  audience: "crew",
              }
            : { title, description: "Bring chairs", taskType, audience: "crew" };
    for (const [key, value] of Object.entries(values)) data.append(key, value);
    return data;
};
const stored = (title: string) => fakeDb.col("Tasks").docs.find((t) => t.title === title);

const create = async (did: string, title: string, taskType: "outcome" | "shift") => {
    sessionDid = did;
    return await createTaskAction("artist", form(title, taskType));
};

beforeEach(() => seed());

describe("made by someone who can approve it: starts open", () => {
    test("an admin's task: open, 'Task created', no review notice", async () => {
        const result = await create(ADMIN, "Chairs", "outcome");
        expect(result.success).toBe(true);
        expect(result.message).toBe("Task created");
        expect(stored("Chairs")?.stage).toBe("open");
        expect(notified).not.toContain("notifyTaskSubmittedForReview");
    });

    test("an admin's shift: open, 'Shift created'", async () => {
        const result = await create(ADMIN, "Door", "shift");
        expect(result.success).toBe(true);
        expect(result.message).toBe("Shift created");
        expect(stored("Door")?.stage).toBe("open");
        expect(notified).not.toContain("notifyTaskSubmittedForReview");
    });

    test("a moderator's shift: open", async () => {
        await create(MODERATOR, "Bar", "shift");
        expect(stored("Bar")?.stage).toBe("open");
    });
});

describe("anyone else: waits for review, or can't create, as before", () => {
    test("an unverified moderator can't create at all (tasks.create has the same gate): nothing opens early", async () => {
        const result = await create(UNVERIFIED_MODERATOR, "Lights", "shift");
        expect(result.success).toBe(false);
        expect(stored("Lights")).toBeUndefined();
    });

    test("a member allowed to create by the circle's rules, without Approve tasks: review", async () => {
        seed({ tasks: { create: ["admins", "moderators", "members"] } });
        const result = await create(MEMBER, "Posters", "outcome");
        expect(result.success).toBe(true);
        expect(result.message).toBe("Task submitted for review");
        expect(stored("Posters")?.stage).toBe("review");
        expect(notified).toContain("notifyTaskSubmittedForReview");
    });

    test("the circle's rules decide: review taken away from moderators means review", async () => {
        seed({ tasks: { review: ["admins"] } });
        const result = await create(MODERATOR, "Sound", "shift");
        expect(result.message).toBe("Shift submitted for review");
        expect(stored("Sound")?.stage).toBe("review");
    });

    test("the circle's rules decide: Approve tasks given to members means open", async () => {
        seed({ tasks: { create: ["admins", "moderators", "members"], review: ["admins", "moderators", "members"] } });
        await create(MEMBER, "Flyers", "outcome");
        expect(stored("Flyers")?.stage).toBe("open");
    });

    test("not a member: refused, nothing created", async () => {
        const result = await create(OUTSIDER, "Nope", "outcome");
        expect(result.success).toBe(false);
        expect(stored("Nope")).toBeUndefined();
    });
});
