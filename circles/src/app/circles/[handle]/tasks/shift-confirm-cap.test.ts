// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/shift-confirm-cap.test.ts"
// Crew round 2, commit 1 (2026-11-18): confirming a shift sign-up never checked capacity. That was safe
// only while sign-up stopped at participants.length >= slots; with more sign-ups than places, an
// organiser could confirm 5 people for 2 places. Now verifyShiftParticipantAction refuses with "All
// places are confirmed" when confirmed >= slots, and the write itself carries the condition ($expr),
// so two organisers confirming at the same moment can't go over.
// The database is in-memory fakes; the session and notifications are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_ID = "64f800000000000000000022";
const TASK_ID = "64f8000000000000000000d1";
const ADMIN = "did:test:admin";
const OTHER_ADMIN = "did:test:admin-2";
const C1 = "did:test:c1";
const C2 = "did:test:c2";
const C3 = "did:test:c3";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) => {
        if (feature === features.tasks.view) return true;
        return did === ADMIN || did === OTHER_ADMIN;
    },
}));
const confirmedNotices: string[] = [];
const realNotifications = await import("@/lib/data/notifications");
mock.module("@/lib/data/notifications", () => ({
    ...Object.fromEntries(
        Object.entries(realNotifications).map(([name, value]) => [
            name,
            name.startsWith("notify") ? async () => undefined : value,
        ]),
    ),
    notifyTaskShiftConfirmed: async (_task: unknown, _confirmer: unknown, participant: { did: string }) => {
        confirmedNotices.push(participant.did);
    },
}));
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

const { verifyShiftParticipantAction } = await import("./actions");

const joined = new Date("2026-11-10T10:00:00Z");
const confirmedAt = new Date("2026-11-11T10:00:00Z");
const pending = (userDid: string) => ({ userDid, joinedAt: joined });
const confirmed = (userDid: string) => ({ userDid, joinedAt: joined, verifiedAt: confirmedAt, verifiedBy: ADMIN });

type Participant = { userDid: string; joinedAt: Date; verifiedAt?: Date; verifiedBy?: string };
const shift = (participants: Participant[], slots = 2) => ({
    _id: new ObjectId(TASK_ID),
    circleId: CIRCLE_ID,
    createdBy: ADMIN,
    title: "Door shift",
    taskType: "shift",
    stage: "open",
    userGroups: ["everyone"],
    slots,
    shiftStartTime: "18:00",
    shiftDurationMinutes: 120,
    targetDate: new Date("2027-01-10T00:00:00Z"),
    participants,
});
const copy = (task: ReturnType<typeof shift>) => ({ ...task, participants: task.participants.map((p) => ({ ...p })) });

// `read` is what getTaskById sees (its aggregate); by default the stored document itself. A separate
// copy stands for a read made before someone else's write landed.
const seed = (stored: ReturnType<typeof shift>, read?: ReturnType<typeof shift>) => {
    fakeDb.reset({
        Circles: [{ _id: new ObjectId(CIRCLE_ID), did: "did:test:y", handle: "y", circleType: "circle" }],
        Tasks: [stored],
    });
    fakeDb.setAggregateResult("Tasks", read ? [read] : fakeDb.col("Tasks").docs, { applyLeadingMatch: true });
};
const storedParticipants = () => fakeDb.col("Tasks").docs[0].participants as Participant[];
const confirmedDids = () =>
    storedParticipants()
        .filter((p) => p.verifiedAt)
        .map((p) => p.userDid);

beforeEach(() => {
    sessionDid = ADMIN;
    confirmedNotices.length = 0;
});

describe("confirm cap: confirmations never exceed places", () => {
    test("below capacity: confirming a pending sign-up still works and confirms that entry only", async () => {
        seed(shift([confirmed(C1), pending(C2), pending(C3)]));
        const result = await verifyShiftParticipantAction("y", TASK_ID, C2);
        expect(result.success).toBe(true);
        expect(confirmedDids()).toEqual([C1, C2]);
        expect(storedParticipants()[1].verifiedBy).toBe(ADMIN);
        expect(storedParticipants()[2].verifiedAt).toBeUndefined();
        expect(confirmedNotices).toEqual([C2]);
    });

    test("2 places, 2 confirmed: a third confirm is refused, nothing is written, nobody is notified", async () => {
        seed(shift([confirmed(C1), confirmed(C2), pending(C3)]));
        const before = JSON.stringify(fakeDb.col("Tasks").docs);
        const result = await verifyShiftParticipantAction("y", TASK_ID, C3);
        expect(result).toEqual({ success: false, message: "All places are confirmed" });
        expect(JSON.stringify(fakeDb.col("Tasks").docs)).toBe(before);
        expect(confirmedNotices).toEqual([]);
    });

    test("the write itself checks: a read made before another confirm landed can't go over", async () => {
        // The action read 1 confirmed of 2; by the time it writes, the database already has 2.
        const stored = shift([confirmed(C1), confirmed(C2), pending(C3)]);
        const staleRead = shift([confirmed(C1), pending(C2), pending(C3)]);
        seed(stored, staleRead);
        const before = JSON.stringify(fakeDb.col("Tasks").docs);
        const result = await verifyShiftParticipantAction("y", TASK_ID, C3);
        expect(result).toEqual({ success: false, message: "All places are confirmed" });
        expect(JSON.stringify(fakeDb.col("Tasks").docs)).toBe(before);
        expect(confirmedNotices).toEqual([]);
    });

    test("two organisers confirming at the same moment for the last place: exactly one wins", async () => {
        const stored = shift([confirmed(C1), pending(C2), pending(C3)]);
        // Both reads see the same state: 1 of 2 confirmed.
        seed(stored, copy(stored));
        const [first, second] = await Promise.all([
            (async () => {
                sessionDid = ADMIN;
                return verifyShiftParticipantAction("y", TASK_ID, C2);
            })(),
            (async () => {
                sessionDid = OTHER_ADMIN;
                return verifyShiftParticipantAction("y", TASK_ID, C3);
            })(),
        ]);
        expect([first.success, second.success].filter(Boolean)).toHaveLength(1);
        expect(confirmedDids()).toHaveLength(2);
        expect(confirmedNotices).toHaveLength(1);
        const loser = first.success ? second : first;
        expect(loser.message).toBe("All places are confirmed");
    });

    test("a shift with places to spare (3 places, 2 confirmed) confirms normally", async () => {
        seed(shift([confirmed(C1), confirmed(C2), pending(C3)], 3));
        const result = await verifyShiftParticipantAction("y", TASK_ID, C3);
        expect(result.success).toBe(true);
        expect(confirmedDids()).toEqual([C1, C2, C3]);
    });
});
