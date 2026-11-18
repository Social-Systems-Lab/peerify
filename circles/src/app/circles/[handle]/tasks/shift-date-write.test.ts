// Run: IS_BUILD=true bun test "src/app/circles/[handle]/tasks/shift-date-write.test.ts"
// Shift dates 4/5 (2026-11-18): the task form sends the picked day as "YYYY-MM-DD" and the server
// stores 12:00 UTC of that day, the same calendar day in every zone from UTC-11 to UTC+11. An ISO
// datetime (from a form loaded before the change) is stored as its calendar date in the shift's zone
// (Africa/Johannesburg), so a Cape Town local-midnight pick still lands on the right day.
// Harness as in crew-only-shifts.test.ts and task-edit-keeps-links.test.ts.

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

const CIRCLE_ID = "64f800000000000000000001";
const TASK_ID = "64f8000000000000000000b1";
const ADMIN = "did:test:admin";

let sessionDid: string | undefined = ADMIN;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, _circleId: string, feature: unknown) => {
        if (feature === features.tasks.view) return true;
        return did === ADMIN;
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

const { createTaskAction, updateTaskAction } = await import("./actions");

const storedShift = () => ({
    _id: new ObjectId(TASK_ID),
    circleId: CIRCLE_ID,
    createdBy: ADMIN,
    taskType: "shift",
    title: "Door crew",
    description: "Welcome guests",
    stage: "open",
    userGroups: ["admins", "moderators", "crew"],
    slots: 2,
    shiftStartTime: "18:00",
    shiftDurationMinutes: 120,
    targetDate: new Date("2026-12-05T22:00:00.000Z"),
    participants: [],
});

beforeEach(() => {
    sessionDid = ADMIN;
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
        ],
        Tasks: [storedShift()],
    });
    fakeDb.setAggregateResult("Tasks", [{ ...storedShift(), _id: TASK_ID }]);
});

const shiftForm = (targetDate: string) => {
    const form = new FormData();
    const values: Record<string, string> = {
        title: "Kitchen",
        description: "Help in the kitchen",
        taskType: "shift",
        slots: "2",
        shiftStartTime: "18:00",
        shiftDurationMinutes: "120",
        targetDate,
        audience: "crew",
    };
    for (const [key, value] of Object.entries(values)) form.append(key, value);
    return form;
};

const created = () => fakeDb.col("Tasks").docs.find((t) => t.title === "Kitchen");
const updated = () => fakeDb.col("Tasks").docs.find((t) => String(t._id) === TASK_ID);

describe("creating a shift", () => {
    test("'2026-12-06' from the form is stored as 12:00 UTC on 6 Dec", async () => {
        const result = await createTaskAction("venue", shiftForm("2026-12-06"));
        expect(result.success).toBe(true);
        expect((created()?.targetDate as Date).toISOString()).toBe("2026-12-06T12:00:00.000Z");
    });

    test("an ISO datetime (Cape Town local midnight) is stored as 12:00 UTC on 6 Dec", async () => {
        const result = await createTaskAction("venue", shiftForm("2026-12-05T22:00:00.000Z"));
        expect(result.success).toBe(true);
        expect((created()?.targetDate as Date).toISOString()).toBe("2026-12-06T12:00:00.000Z");
    });

    test("a date that doesn't exist is refused", async () => {
        const result = await createTaskAction("venue", shiftForm("2026-02-30"));
        expect(result.success).toBe(false);
        expect(created()).toBeUndefined();
    });
});

describe("editing a shift", () => {
    test("'2026-12-06' is stored as 12:00 UTC on 6 Dec", async () => {
        const result = await updateTaskAction("venue", TASK_ID, shiftForm("2026-12-06"));
        expect(result.success).toBe(true);
        expect((updated()?.targetDate as Date).toISOString()).toBe("2026-12-06T12:00:00.000Z");
    });

    test("an ISO datetime from an old form keeps the Cape Town day", async () => {
        const result = await updateTaskAction("venue", TASK_ID, shiftForm("2026-12-05T22:00:00.000Z"));
        expect(result.success).toBe(true);
        expect((updated()?.targetDate as Date).toISOString()).toBe("2026-12-06T12:00:00.000Z");
    });
});
