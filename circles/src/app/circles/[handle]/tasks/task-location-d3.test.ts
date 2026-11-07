// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/task-location-d3.test.ts"
// Leak round 3, M5, Tim's decision D3 (2026-11-07): everyone who could view tasks got a task's or
// shift's exact location (street, pin), the shift's "Important for participants" note and the
// "changes requested" note. Now:
// - location: exact for the author, the assignee, people signed up and claimants (pending or
//   approved); city level for everyone else;
// - "Important for participants": for the author, the assignee and people signed up; others get
//   participantNotesHidden (the page says "Details for participants appear once you sign up");
// - "changes requested": for the author, the assignee, claimants and reviewers.
// People with tasks.assign or tasks.moderate and platform admins still get everything. The
// database is in-memory fakes; the session and permission checks are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_ID = "64f800000000000000000001";
const SHIFT_ID = "64f8000000000000000000a1";
const AUTHOR = "did:test:author";
const ASSIGNEE = "did:test:assignee";
const PARTICIPANT = "did:test:participant";
const CLAIMANT = "did:test:claimant";
const WITHDRAWN = "did:test:withdrawn";
const REVIEWER = "did:test:reviewer";
const MODERATOR = "did:test:moderator";
const ASSIGNER = "did:test:assigner";
const STRANGER = "did:test:stranger";
const PLATFORM_ADMIN = "did:test:platform-admin";

const STREET = "Canary Loading Dock 4";
const LNG = 18.061234;
const PARTICIPANT_NOTE = "CANARY: door code 4711, ask for Sam";
const CHANGES_NOTE = "CANARY CHANGES: photos missing";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, _circleId: string, feature: unknown) => {
        if (feature === features.tasks.view) return true;
        if (feature === features.tasks.assign) return did === ASSIGNER;
        if (feature === features.tasks.moderate) return did === MODERATOR;
        if (feature === features.tasks.review) return did === REVIEWER;
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCircleByHandle: async (handle: string) => fakeDb.col("Circles").docs.find((c) => c.handle === handle) ?? null,
}));

const { getTaskAction } = await import("./actions");

const shift = () => ({
    _id: SHIFT_ID,
    circleId: CIRCLE_ID,
    createdBy: AUTHOR,
    assignedTo: ASSIGNEE,
    taskType: "shift",
    title: "Load-in",
    stage: "open",
    userGroups: ["everyone"],
    location: { precision: 4, city: "Stockholm", country: "Sweden", street: STREET, lngLat: { lng: LNG, lat: 59.33 } },
    participantNotes: PARTICIPANT_NOTE,
    reviewRequestedChangesNote: CHANGES_NOTE,
    participants: [{ userDid: PARTICIPANT, joinedAt: new Date() }],
    claims: [
        { claimId: "c1", claimantDid: CLAIMANT, status: "pending", createdAt: new Date() },
        { claimId: "c2", claimantDid: WITHDRAWN, status: "withdrawn", createdAt: new Date() },
    ],
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(CIRCLE_ID), did: "did:test:band", handle: "band", name: "Band", circleType: "circle" },
            { _id: new ObjectId(), did: PLATFORM_ADMIN, handle: "pa", circleType: "user", isAdmin: true },
        ],
    });
    fakeDb.setAggregateResult("Tasks", [shift()]);
});

const view = async (did: string) => {
    sessionDid = did;
    const task = await getTaskAction("band", SHIFT_ID);
    const text = JSON.stringify(task);
    return {
        task,
        exact: text.includes(STREET) || text.includes(String(LNG)),
        participantNote: text.includes(PARTICIPANT_NOTE),
        changesNote: text.includes(CHANGES_NOTE),
    };
};

describe("location", () => {
    test("a stranger, a withdrawn claimant and a reviewer get the city only", async () => {
        for (const did of [STRANGER, WITHDRAWN, REVIEWER]) {
            const v = await view(did);
            expect(v.exact).toBe(false);
            expect(v.task?.location?.city).toBe("Stockholm");
        }
    });

    test("the author, the assignee, a participant and a pending claimant get it exact", async () => {
        for (const did of [AUTHOR, ASSIGNEE, PARTICIPANT, CLAIMANT]) {
            expect((await view(did)).exact).toBe(true);
        }
    });
});

describe("'Important for participants'", () => {
    test("a stranger and a claimant who isn't signed up get only the hint", async () => {
        for (const did of [STRANGER, CLAIMANT]) {
            const v = await view(did);
            expect(v.participantNote).toBe(false);
            expect(v.task?.participantNotesHidden).toBe(true);
        }
    });

    test("a participant, the author and the assignee get the note", async () => {
        for (const did of [PARTICIPANT, AUTHOR, ASSIGNEE]) {
            const v = await view(did);
            expect(v.participantNote).toBe(true);
            expect(v.task?.participantNotesHidden).toBeUndefined();
        }
    });
});

describe("'changes requested'", () => {
    test("a stranger and a participant don't get it", async () => {
        for (const did of [STRANGER, PARTICIPANT]) expect((await view(did)).changesNote).toBe(false);
    });

    test("the author, the assignee, a claimant and a reviewer do", async () => {
        for (const did of [AUTHOR, ASSIGNEE, CLAIMANT, REVIEWER]) expect((await view(did)).changesNote).toBe(true);
    });
});

describe("managers still see everything", () => {
    test("moderator, assigner and platform admin: exact location and both notes", async () => {
        for (const did of [MODERATOR, ASSIGNER, PLATFORM_ADMIN]) {
            const v = await view(did);
            expect(v.exact && v.participantNote && v.changesNote).toBe(true);
            expect(v.task?.participantNotesHidden).toBeUndefined();
        }
    });
});
