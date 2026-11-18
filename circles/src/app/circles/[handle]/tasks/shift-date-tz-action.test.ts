// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/shift-date-tz-action.test.ts"
// Shift dates and time zones (staging bug, 2026-11-18): the server actions compute a shift's end with
// their own getShiftEndAt (actions.ts), in the server's zone. For Door crew (Sun 6 Dec 18:00–20:00 in
// Cape Town, targetDate picked in Cape Town = 2026-12-05T22:00:00Z), a server in Europe/Stockholm puts
// the end at Sat 5 Dec 20:00 CET, so attendance can be reviewed a day before the shift happens.
// FAILING FIRST: see src/lib/tasks/shift-date-tz.test.ts for the proposed rule.
// Harness as in task-actions-circle-check.test.ts: in-memory fakes, session and notifications stubbed,
// "admin of the circle" as the permission check.

import { afterAll, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const Y_ID = "64f800000000000000000022";
const TASK_ID = "64f8000000000000000000d1";
const ADMIN = "did:test:admin";
const CREW = "did:test:crew";

let sessionDid: string | undefined = ADMIN;
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
    getCircleByHandle: async (handle: string) => {
        const circle = fakeDb.col("Circles").docs.find((c) => c.handle === handle);
        return circle ? { ...circle, _id: circle._id.toString() } : null;
    },
}));

const actions = await import("./actions");

const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = "Europe/Stockholm"; // the staging server's zone
// The actions read the clock with Date.now() (hasShiftCompleted); this bun's types have no setSystemTime.
const realDateNow = Date.now;
const setSystemTime = (at: Date) => {
    Date.now = () => at.getTime();
};
afterAll(() => {
    process.env.TZ = ORIGINAL_TZ;
    Date.now = realDateNow;
});

const seed = () => {
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(Y_ID),
                did: "did:test:y",
                handle: "y",
                circleType: "circle",
                enabledModules: ["tasks", "shifts"],
            },
        ],
        Members: [
            { _id: new ObjectId(), circleId: Y_ID, userDid: ADMIN, userGroups: ["admins", "members"] },
            { _id: new ObjectId(), circleId: Y_ID, userDid: CREW, userGroups: ["members", "crew"] },
        ],
        Tasks: [
            {
                _id: new ObjectId(TASK_ID),
                circleId: Y_ID,
                createdBy: ADMIN,
                title: "Door crew",
                userGroups: ["admins", "moderators", "crew"],
                taskType: "shift",
                stage: "open",
                slots: 2,
                shiftStartTime: "18:00",
                shiftDurationMinutes: 120,
                targetDate: new Date("2026-12-05T22:00:00.000Z"), // Sun 6 Dec, picked in Cape Town
                participants: [
                    {
                        userDid: CREW,
                        joinedAt: new Date("2026-12-01T10:00:00Z"),
                        verifiedAt: new Date("2026-12-02T10:00:00Z"),
                        verifiedBy: ADMIN,
                    },
                ],
            },
        ],
    });
    fakeDb.setAggregateResult("Tasks", fakeDb.col("Tasks").docs, { applyLeadingMatch: true });
};

describe("attendance review waits for the real end of the shift (server in Europe/Stockholm)", () => {
    test("Sat 5 Dec, 22:00 in Cape Town (the day before): refused", async () => {
        seed();
        sessionDid = ADMIN;
        setSystemTime(new Date("2026-12-05T20:00:00Z"));
        const result = await actions.reviewShiftAttendanceAction("y", TASK_ID, CREW, "attended");
        expect(result.success).toBe(false);
        expect(result.message).toBe("Attendance can only be reviewed after the shift has completed");
    });

    test("Sun 6 Dec, 19:30 in Cape Town (during the shift): refused", async () => {
        seed();
        sessionDid = ADMIN;
        setSystemTime(new Date("2026-12-06T17:30:00Z"));
        const result = await actions.reviewShiftAttendanceAction("y", TASK_ID, CREW, "attended");
        expect(result.success).toBe(false);
    });

    test("Sun 6 Dec, 20:30 in Cape Town (after it ended): allowed", async () => {
        seed();
        sessionDid = ADMIN;
        setSystemTime(new Date("2026-12-06T18:30:00Z"));
        const result = await actions.reviewShiftAttendanceAction("y", TASK_ID, CREW, "attended");
        expect(result.success).toBe(true);
    });
});
