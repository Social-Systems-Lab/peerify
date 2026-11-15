// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/crew-only-shifts.test.ts"
// Crew R1, item 2, with Tim's decision B (2026-11-14):
// - a task or shift can be for "Crew only" (userGroups admins, moderators, crew); only those groups
//   see it and can sign up;
// - on a crew-only shift the exact location and "Important for participants" go to confirmed
//   participants only (plus the author, assigners/moderators and platform admins), not to pending
//   sign-ups; shifts open to everyone keep D3 (anyone signed up);
// - the Noticeboard post for a shift never contains the participant note, and a crew-only shift is
//   never posted.
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
    getCircleByHandle: async (handle: string) => fakeDb.col("Circles").docs.find((c) => c.handle === handle) ?? null,
}));

const { createTaskAction, getTaskAction, joinShiftTaskAction } = await import("./actions");
const { buildShiftNoticeboardPostContent } = await import("@/lib/tasks/shift-noticeboard");

const shift = (userGroups: string[]) => ({
    _id: SHIFT_ID,
    circleId: CIRCLE_ID,
    createdBy: AUTHOR,
    taskType: "shift",
    title: "Door",
    description: DESCRIPTION,
    stage: "open",
    userGroups,
    slots: 4,
    shiftStartTime: "18:00",
    shiftDurationMinutes: 120,
    targetDate: new Date("2026-12-05T00:00:00Z"),
    location: { precision: 4, city: "Stockholm", country: "Sweden", street: STREET, lngLat: { lng: LNG, lat: 59.33 } },
    participantNotes: PARTICIPANT_NOTE,
    participants: [
        { userDid: PENDING, joinedAt: new Date() },
        { userDid: CONFIRMED, joinedAt: new Date(), verifiedAt: new Date(), verifiedBy: CIRCLE_ADMIN },
    ],
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
                enabledModules: ["tasks", "shifts"],
            },
            { _id: new ObjectId(), did: PLATFORM_ADMIN, handle: "pa", circleType: "user", isAdmin: true },
        ],
        Members: [
            member(CIRCLE_ADMIN, ["admins", "members"]),
            member(CREW, ["crew", "members"]),
            member(PENDING, ["crew", "members"]),
            member(CONFIRMED, ["crew", "members"]),
            member(FOLLOWER, ["members"]),
        ],
        Tasks: [{ ...shift(userGroups), _id: new ObjectId(SHIFT_ID) }],
    });
    fakeDb.setAggregateResult("Tasks", [shift(userGroups)]);
};

beforeEach(() => {
    sessionDid = undefined;
    seed(CREW_ONLY);
});

const view = async (did: string) => {
    sessionDid = did;
    const task = await getTaskAction("venue", SHIFT_ID);
    const text = JSON.stringify(task);
    return {
        task,
        exact: text.includes(STREET) || text.includes(String(LNG)),
        note: text.includes(PARTICIPANT_NOTE),
    };
};

const shiftForm = (fields: Record<string, string>) => {
    const form = new FormData();
    const values: Record<string, string> = {
        title: "Bar",
        description: DESCRIPTION,
        taskType: "shift",
        slots: "2",
        shiftStartTime: "19:00",
        shiftDurationMinutes: "120",
        targetDate: "2026-12-05T00:00:00.000Z",
        participantNotes: PARTICIPANT_NOTE,
        ...fields,
    };
    for (const [key, value] of Object.entries(values)) form.append(key, value);
    return form;
};

describe("creating a crew-only shift", () => {
    test("audience 'crew' stores admins, moderators and crew", async () => {
        sessionDid = AUTHOR;
        const result = await createTaskAction("venue", shiftForm({ audience: "crew" }));
        expect(result.success).toBe(true);
        const created = fakeDb.col("Tasks").docs.find((d) => d.title === "Bar");
        expect(created?.userGroups).toEqual(CREW_ONLY);
    });

    test("audience 'everyone' stores everyone", async () => {
        sessionDid = AUTHOR;
        await createTaskAction("venue", shiftForm({ audience: "everyone" }));
        expect(fakeDb.col("Tasks").docs.find((d) => d.title === "Bar")?.userGroups).toEqual(["everyone"]);
    });

    test("a crew-only shift is never posted to the Noticeboard, even when asked", async () => {
        sessionDid = AUTHOR;
        await createTaskAction("venue", shiftForm({ audience: "crew", publishToNoticeboard: "true" }));
        expect(fakeDb.col("Posts").docs).toHaveLength(0);
        expect(fakeDb.col("Tasks").docs.find((d) => d.title === "Bar")?.noticeboardPostId).toBeUndefined();
    });
});

describe("the Noticeboard post never contains the participant note", () => {
    test("a shift open to everyone: the post has the description, not the note", async () => {
        sessionDid = AUTHOR;
        await createTaskAction("venue", shiftForm({ audience: "everyone", publishToNoticeboard: "true" }));
        const posts = fakeDb.col("Posts").docs;
        expect(posts).toHaveLength(1);
        expect(JSON.stringify(posts[0])).not.toContain(PARTICIPANT_NOTE);
        expect(posts[0].content).toContain(DESCRIPTION);
    });

    test("the post text is built from the description only", () => {
        const content = buildShiftNoticeboardPostContent({
            description: DESCRIPTION,
            participantNotes: PARTICIPANT_NOTE,
        } as { description: string });
        expect(content).not.toContain(PARTICIPANT_NOTE);
        expect(content).toContain(DESCRIPTION);
    });
});

describe("signing up to a crew-only shift", () => {
    test("a follower who isn't Crew can't see or join it", async () => {
        sessionDid = FOLLOWER;
        expect(await getTaskAction("venue", SHIFT_ID)).toBeNull();
        const result = await joinShiftTaskAction("venue", SHIFT_ID);
        expect(result.success).toBe(false);
        expect(fakeDb.col("Tasks").docs[0].participants.map((p: { userDid: string }) => p.userDid)).not.toContain(
            FOLLOWER,
        );
    });

    test("a stranger can't join it", async () => {
        sessionDid = STRANGER;
        expect((await joinShiftTaskAction("venue", SHIFT_ID)).success).toBe(false);
    });

    test("a Crew member can join it", async () => {
        sessionDid = CREW;
        const result = await joinShiftTaskAction("venue", SHIFT_ID);
        expect(result.success).toBe(true);
        expect(fakeDb.col("Tasks").docs[0].participants.map((p: { userDid: string }) => p.userDid)).toContain(CREW);
    });
});

describe("decision B: who gets the exact location and the participant note on a crew-only shift", () => {
    test("a pending sign-up gets neither, only the hint", async () => {
        const v = await view(PENDING);
        expect(v.task).not.toBeNull();
        expect(v.exact).toBe(false);
        expect(v.note).toBe(false);
        expect(v.task?.participantNotesHidden).toBe(true);
        expect(v.task?.location?.city).toBe("Stockholm");
    });

    test("a confirmed participant gets both", async () => {
        const v = await view(CONFIRMED);
        expect(v.exact && v.note).toBe(true);
    });

    test("a Crew member who isn't signed up gets neither", async () => {
        const v = await view(CREW);
        expect(v.task).not.toBeNull();
        expect(v.exact || v.note).toBe(false);
    });

    test("the author and a circle admin still see the shift with both", async () => {
        for (const did of [AUTHOR, CIRCLE_ADMIN]) {
            const v = await view(did);
            expect(v.task).not.toBeNull();
            expect(v.exact && v.note).toBe(true);
        }
    });
});

describe("shifts open to everyone keep D3", () => {
    test("a pending sign-up still gets the location and the note", async () => {
        seed(["everyone"]);
        const v = await view(PENDING);
        expect(v.exact && v.note).toBe(true);
    });

    test("a follower can still see and join it", async () => {
        seed(["everyone"]);
        sessionDid = FOLLOWER;
        expect((await joinShiftTaskAction("venue", SHIFT_ID)).success).toBe(true);
    });
});
