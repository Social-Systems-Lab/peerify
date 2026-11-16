// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/task-signups-private.test.ts"
// Sign-ups and claims (Tim, 2026-11-16): participants[] and claims[] went to every viewer of a task;
// only the UI hid pending ones, while the shift page says "A participant only appears publicly after
// admin confirmation". The server now keeps that promise (shapeTaskNotesForViewer):
// - managers (tasks.assign / tasks.moderate), the author and platform admins: everything, as before;
// - a person signed up or claiming: their own entry in full;
// - everyone else: confirmed participants only, no claims, and pendingParticipantCount for the
//   "N pending" and "full" counts the page shows.
// The database is in-memory fakes; the session and notifications are stubbed, and the permission
// check is "admin of that circle" for manager features, read from the fake Members.

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

const CIRCLE_ID = "64f800000000000000000033";
const SHIFT_ID = "64f8000000000000000000e1";
const TASK_ID = "64f8000000000000000000e2";
const AUTHOR = "did:test:author";
const ADMIN = "did:test:admin"; // tasks.assign / tasks.moderate
const PENDING = "did:test:pending";
const CONFIRMED = "did:test:confirmed";
const CLAIMANT = "did:test:claimant";
const OTHER_CLAIMANT = "did:test:other-claimant";
const STRANGER = "did:test:stranger"; // a member, not involved
const PLATFORM_ADMIN = "did:test:platform-admin";
const CLAIM_NOTE = "CANARY claim note: I have a van";
const OTHER_NOTE = "CANARY other note: call me on 0701234567";

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

const { getTaskAction, getTasksAction } = await import("./actions");
const { filterTasksForViewer } = await import("@/lib/data/task");
const { getShiftPendingCount, getShiftSignedUpCount, getShiftConfirmedCount } = await import(
    "@/components/modules/tasks/shift-task-utils"
);

const past = new Date("2026-11-01T00:00:00Z");
const profile = (did: string) => ({ _id: did, did, handle: did.split(":").pop(), name: did, circleType: "user" });

const shift = {
    _id: SHIFT_ID,
    circleId: CIRCLE_ID,
    createdBy: AUTHOR,
    author: profile(AUTHOR),
    taskType: "shift",
    title: "Door",
    stage: "open",
    userGroups: ["everyone"],
    slots: 2,
    shiftStartTime: "18:00",
    shiftDurationMinutes: 120,
    targetDate: new Date("2027-01-10T00:00:00Z"),
    participants: [
        { userDid: PENDING, joinedAt: past },
        { userDid: CONFIRMED, joinedAt: past, verifiedAt: past, verifiedBy: ADMIN },
    ],
    participantProfiles: [profile(PENDING), profile(CONFIRMED)],
};
const task = {
    _id: TASK_ID,
    circleId: CIRCLE_ID,
    createdBy: AUTHOR,
    author: profile(AUTHOR),
    taskType: "outcome",
    title: "Bring a PA",
    stage: "open",
    userGroups: ["everyone"],
    claims: [
        { claimId: "c1", claimantDid: CLAIMANT, status: "pending", createdAt: past, note: CLAIM_NOTE },
        { claimId: "c2", claimantDid: OTHER_CLAIMANT, status: "declined", createdAt: past, note: OTHER_NOTE },
    ],
};

const member = (userDid: string, userGroups: string[]) => ({
    _id: new ObjectId(),
    circleId: CIRCLE_ID,
    userDid,
    userGroups,
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(CIRCLE_ID),
                did: "did:test:venue",
                handle: "venue",
                circleType: "circle",
                enabledModules: ["tasks", "shifts"],
            },
            { _id: new ObjectId(), did: PLATFORM_ADMIN, handle: "pa", circleType: "user", isAdmin: true },
        ],
        Members: [
            member(ADMIN, ["admins", "members"]),
            member(AUTHOR, ["members"]),
            member(PENDING, ["members"]),
            member(CONFIRMED, ["members"]),
            member(CLAIMANT, ["members"]),
            member(OTHER_CLAIMANT, ["members"]),
            member(STRANGER, ["members"]),
        ],
        Tasks: [
            { ...shift, _id: new ObjectId(SHIFT_ID) },
            { ...task, _id: new ObjectId(TASK_ID) },
        ],
    });
    fakeDb.setAggregateResult("Tasks", [shift, task]);
});

const viewOne = async (did: string, id: string) => {
    sessionDid = did;
    fakeDb.setAggregateResult("Tasks", [id === SHIFT_ID ? shift : task]);
    return getTaskAction("venue", id);
};
const viewList = async (did: string) => {
    sessionDid = did;
    return (await getTasksAction("venue")).tasks;
};
const dids = (t: { participants?: { userDid: string }[] } | null | undefined) =>
    (t?.participants ?? []).map((p) => p.userDid).sort();
const claimDids = (t: { claims?: { claimantDid: string }[] } | null | undefined) =>
    (t?.claims ?? []).map((c) => c.claimantDid).sort();

describe("an uninvolved viewer: confirmed participants only, no claims", () => {
    test("getTaskAction, shift: no pending participant anywhere, counts still right", async () => {
        const s = await viewOne(STRANGER, SHIFT_ID);
        expect(s).not.toBeNull();
        expect(dids(s)).toEqual([CONFIRMED]);
        expect(JSON.stringify(s)).not.toContain(PENDING);
        expect(s!.pendingParticipantCount).toBe(1);
        expect(getShiftConfirmedCount(s!)).toBe(1);
        expect(getShiftPendingCount(s!)).toBe(1);
        expect(getShiftSignedUpCount(s!)).toBe(2);
    });

    test("getTaskAction, task: no claim, no claimant DID, no note", async () => {
        const t = await viewOne(STRANGER, TASK_ID);
        expect(t).not.toBeNull();
        expect(t!.claims).toEqual([]);
        const text = JSON.stringify(t);
        for (const secret of [CLAIMANT, OTHER_CLAIMANT, CLAIM_NOTE, OTHER_NOTE]) expect(text).not.toContain(secret);
    });

    test("the task list: the same", async () => {
        const list = await viewList(STRANGER);
        expect(list).toHaveLength(2);
        const text = JSON.stringify(list);
        for (const secret of [PENDING, CLAIMANT, OTHER_CLAIMANT, CLAIM_NOTE, OTHER_NOTE])
            expect(text).not.toContain(secret);
        expect(text).toContain(CONFIRMED);
    });

    test("filterTasksForViewer (event panel, goal page, home): the same", async () => {
        const shaped = await filterTasksForViewer([shift, task] as never[], STRANGER);
        const text = JSON.stringify(shaped);
        for (const secret of [PENDING, CLAIMANT, OTHER_CLAIMANT, CLAIM_NOTE, OTHER_NOTE])
            expect(text).not.toContain(secret);
    });

    test("signed-out shaping (filterTasksForViewer without a viewer): the same", async () => {
        const shaped = await filterTasksForViewer([shift, task] as never[], undefined);
        const text = JSON.stringify(shaped);
        for (const secret of [PENDING, CLAIMANT, OTHER_CLAIMANT, CLAIM_NOTE, OTHER_NOTE])
            expect(text).not.toContain(secret);
    });
});

describe("the person's own entry still shows", () => {
    test("a pending sign-up sees their own entry, and no one else's pending one", async () => {
        const s = await viewOne(PENDING, SHIFT_ID);
        expect(dids(s)).toEqual([CONFIRMED, PENDING].sort());
        expect(s!.participantProfiles!.map((p) => p.did).sort()).toEqual([CONFIRMED, PENDING].sort());
        expect(getShiftSignedUpCount(s!)).toBe(2);
    });

    test("a claimant sees their own claim with its note, and no other claim", async () => {
        const t = await viewOne(CLAIMANT, TASK_ID);
        expect(claimDids(t)).toEqual([CLAIMANT]);
        expect(t!.claims![0].note).toBe(CLAIM_NOTE);
        expect(JSON.stringify(t)).not.toContain(OTHER_CLAIMANT);
    });
});

describe("managers, the author and platform admins see everything, as before", () => {
    test("a circle admin (tasks.assign / moderate): every participant and claim, with notes", async () => {
        const s = await viewOne(ADMIN, SHIFT_ID);
        expect(dids(s)).toEqual([CONFIRMED, PENDING].sort());
        expect(s!.pendingParticipantCount).toBeUndefined();
        const t = await viewOne(ADMIN, TASK_ID);
        expect(claimDids(t)).toEqual([CLAIMANT, OTHER_CLAIMANT].sort());
        expect(JSON.stringify(t)).toContain(CLAIM_NOTE);
    });

    test("the author: every participant and claim (others' notes stay hidden, as before)", async () => {
        const s = await viewOne(AUTHOR, SHIFT_ID);
        expect(dids(s)).toEqual([CONFIRMED, PENDING].sort());
        const t = await viewOne(AUTHOR, TASK_ID);
        expect(claimDids(t)).toEqual([CLAIMANT, OTHER_CLAIMANT].sort());
        expect(JSON.stringify(t)).not.toContain(CLAIM_NOTE);
    });

    test("a platform admin: everything", async () => {
        const shaped = await filterTasksForViewer([shift, task] as never[], PLATFORM_ADMIN);
        expect(dids(shaped[0])).toEqual([CONFIRMED, PENDING].sort());
        expect(claimDids(shaped[1])).toEqual([CLAIMANT, OTHER_CLAIMANT].sort());
    });
});
