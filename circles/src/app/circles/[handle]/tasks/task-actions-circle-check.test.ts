// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/task-actions-circle-check.test.ts"
// Cross-circle fix (Tim, 2026-11-16): the task and shift actions take the circle from the URL
// (circleHandle) and check the caller's rights there, but loaded the task by id alone. An admin of
// any circle could act on another circle's task by passing their own circle's handle. Now a task can
// only be acted on through its own circle (isTaskInCircle, the check getTaskAction already had).
// For each action: through another circle's handle it's refused and nothing is written; through the
// task's own circle the normal flow still works.
// The database is in-memory fakes; the session and notifications are stubbed, and the permission
// check is "admin of that circle" (any manager feature), read from the fake Members.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
for (const name of ["Tasks", "Posts"] as const) {
    const fake = (fakeDb.module as unknown as Record<string, unknown>)[name] as {
        insertOne: (doc: Record<string, unknown>) => Promise<unknown>;
    };
    fake.insertOne = (doc) =>
        fakeDb.col(name).insertOne(Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined)));
}
mock.module("@/lib/data/db", () => fakeDb.module);

const X_ID = "64f800000000000000000011"; // the other circle (the caller is its admin)
const Y_ID = "64f800000000000000000022"; // the task's circle
const TASK_ID = "64f8000000000000000000d1";
const AUTHOR = "did:test:author";
const ADMIN_X = "did:test:admin-x"; // admin of X, plain member of Y
const ADMIN_Y = "did:test:admin-y";
const MEMBER_Y = "did:test:member-y";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) => {
        if (feature === features.tasks.view) return true;
        return fakeDb
            .col("Members")
            .docs.some((m) => m.userDid === did && m.circleId === String(circleId) && m.userGroups.includes("admins"));
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
    getUserPrivate: async (did: string) => ({ did, handle: did.split(":").pop(), name: did, circleType: "user" }),
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

const actions = await import("./actions");

const member = (userDid: string, circleId: string, userGroups: string[]) => ({
    _id: new ObjectId(),
    circleId,
    userDid,
    userGroups,
});

const baseTask = {
    circleId: Y_ID,
    createdBy: AUTHOR,
    title: "Bring a PA",
    userGroups: ["everyone"],
};
const outcome = (extra: Record<string, unknown>) => ({ ...baseTask, taskType: "outcome", stage: "open", ...extra });
const shift = (extra: Record<string, unknown>) => ({
    ...baseTask,
    taskType: "shift",
    stage: "open",
    slots: 4,
    shiftStartTime: "18:00",
    shiftDurationMinutes: 120,
    targetDate: new Date("2027-01-10T00:00:00Z"),
    participants: [],
    ...extra,
});

const seed = (task: Record<string, unknown>) => {
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(X_ID),
                did: "did:test:x",
                handle: "x",
                circleType: "circle",
                enabledModules: ["tasks", "shifts"],
            },
            {
                _id: new ObjectId(Y_ID),
                did: "did:test:y",
                handle: "y",
                circleType: "circle",
                enabledModules: ["tasks", "shifts"],
            },
        ],
        Members: [
            member(ADMIN_X, X_ID, ["admins", "members"]),
            member(ADMIN_X, Y_ID, ["members"]),
            member(ADMIN_Y, Y_ID, ["admins", "members"]),
            member(MEMBER_Y, Y_ID, ["members"]),
            member(AUTHOR, Y_ID, ["members"]),
        ],
        Tasks: [{ ...task, _id: new ObjectId(TASK_ID) }],
    });
    // getTaskById reads through an aggregate; serve the live documents, matched by id.
    fakeDb.setAggregateResult("Tasks", fakeDb.col("Tasks").docs, { applyLeadingMatch: true });
};

const snapshot = () =>
    JSON.stringify({
        tasks: fakeDb.col("Tasks").docs,
        posts: fakeDb.col("Posts").docs,
        notifications: fakeDb.col("Notifications").docs,
    });

type Case = {
    name: string;
    task: Record<string, unknown>;
    // The caller: through X's handle they must be refused; ownActor through Y must succeed.
    crossActor: string;
    ownActor: string;
    run: (handle: string) => Promise<{ success: boolean; message?: string }>;
};

const past = new Date("2026-11-01T00:00:00Z");
const assignForm = () => {
    const form = new FormData();
    form.set("assigneeDid", MEMBER_Y);
    return form;
};

const EIGHT: Case[] = [
    {
        name: "updateTaskPriorityAction",
        task: outcome({}),
        crossActor: ADMIN_X,
        ownActor: ADMIN_Y,
        run: (h) => actions.updateTaskPriorityAction(h, TASK_ID, "high"),
    },
    {
        name: "deleteTaskAction",
        task: outcome({}),
        crossActor: ADMIN_X,
        ownActor: ADMIN_Y,
        run: (h) => actions.deleteTaskAction(h, TASK_ID),
    },
    {
        name: "requestTaskChangesAction",
        task: outcome({ stage: "inProgress", assignedTo: MEMBER_Y, submittedForReviewAt: past }),
        crossActor: ADMIN_X,
        ownActor: ADMIN_Y,
        run: (h) => actions.requestTaskChangesAction(h, TASK_ID, "Please add photos"),
    },
    {
        name: "reviewTaskClaimAction",
        task: outcome({
            claims: [{ claimId: "c1", claimantDid: MEMBER_Y, status: "pending", createdAt: past }],
        }),
        crossActor: ADMIN_X,
        ownActor: ADMIN_Y,
        // Declining: approving happened to be blocked already (it checks the claimant's membership in
        // the URL's circle), declining wasn't.
        run: (h) => actions.reviewTaskClaimAction(h, TASK_ID, "c1", "declined"),
    },
    {
        name: "verifyShiftParticipantAction",
        task: shift({ participants: [{ userDid: MEMBER_Y, joinedAt: past }] }),
        crossActor: ADMIN_X,
        ownActor: ADMIN_Y,
        run: (h) => actions.verifyShiftParticipantAction(h, TASK_ID, MEMBER_Y),
    },
    {
        name: "reviewShiftAttendanceAction",
        task: shift({
            targetDate: past,
            participants: [{ userDid: MEMBER_Y, joinedAt: past, verifiedAt: past, verifiedBy: ADMIN_Y }],
        }),
        crossActor: ADMIN_X,
        ownActor: ADMIN_Y,
        run: (h) => actions.reviewShiftAttendanceAction(h, TASK_ID, MEMBER_Y, "attended"),
    },
    {
        name: "changeTaskStageAction",
        task: outcome({ stage: "review" }),
        crossActor: ADMIN_X,
        ownActor: ADMIN_Y,
        run: (h) => actions.changeTaskStageAction(h, TASK_ID, "open"),
    },
    {
        name: "assignTaskAction",
        task: outcome({}),
        crossActor: ADMIN_X,
        ownActor: ADMIN_Y,
        run: (h) => actions.assignTaskAction(h, TASK_ID, assignForm()),
    },
];

const runCases = (title: string, cases: Case[]) =>
    describe(title, () => {
        beforeEach(() => {
            sessionDid = undefined;
        });
        for (const c of cases) {
            test(`${c.name}: through another circle's handle, refused and nothing written`, async () => {
                seed(c.task);
                const before = snapshot();
                sessionDid = c.crossActor;
                const result = await c.run("x");
                expect(result.success).toBe(false);
                expect(snapshot()).toBe(before);
            });
            test(`${c.name}: through the task's own circle, works`, async () => {
                seed(c.task);
                const before = snapshot();
                sessionDid = c.ownActor;
                const result = await c.run("y");
                expect(result.success).toBe(true);
                expect(snapshot()).not.toBe(before);
            });
        }
    });

runCases("the eight manager actions only work through the task's own circle (2026-11-16)", EIGHT);
