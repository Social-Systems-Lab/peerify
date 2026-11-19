// Run: IS_BUILD=true bun test src/lib/data/shift-declined-notice.test.ts
// Staging round fixes (2026-11-19): the task_shift_declined notice must not reveal who declined.
// Its text already leaves the organiser out, but the notice stored the organiser as `user`, so the
// bell showed their picture (and /api/notifications returned their name and did). It now carries
// the circle only, like the crew-joined notice (crew_application_approved), and the bell shows the
// circle's picture. Rows stored before the fix still hold `user`; it is dropped when read.
// The database is in-memory fakes (testing/fake-db.ts); nothing real is touched.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    isAuthorized: async () => true,
    getAuthenticatedUserDid: async () => undefined,
}));

const { notifyTaskShiftDeclined, listNotificationsForUser, shapeStoredNotificationContent } = await import(
    "./notifications"
);
const { showsActorPicture } = await import("@/components/layout/notification-avatar");

const CIRCLE_ID = "64f800000000000000000066";
const ORGANISER = "did:test:organiser";
const VOLUNTEER = "did:test:volunteer";

const organiser = {
    _id: new ObjectId(),
    did: ORGANISER,
    handle: "organiser",
    name: "Canary Organiser",
    picture: { url: "/canary-organiser.png" },
    circleType: "user",
};
const volunteer = { _id: new ObjectId(), did: VOLUNTEER, handle: "volunteer", name: "Vol", circleType: "user" };
const task = {
    _id: new ObjectId(),
    circleId: CIRCLE_ID,
    taskType: "shift",
    title: "Door crew",
};

beforeEach(() => {
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(CIRCLE_ID),
                handle: "secret-space",
                name: "The Secret Space",
                circleType: "circle",
                picture: { url: "/secret-space.png" },
            },
            organiser,
            volunteer,
        ],
    });
});

const stored = () => fakeDb.col("Notifications").docs.filter((n) => n.type === "task_shift_declined");

describe("task_shift_declined does not reveal the organiser", () => {
    test("the stored notice carries the circle and no user", async () => {
        await notifyTaskShiftDeclined(task as never, organiser as never, volunteer as never);
        const rows = stored();
        expect(rows).toHaveLength(1);
        const content = rows[0].content as Record<string, any>;
        expect(content.circle?.handle).toBe("secret-space");
        expect(content.user).toBeUndefined();
        expect(rows[0].actorDid).toBeUndefined();
        expect(JSON.stringify(rows[0])).not.toContain(ORGANISER);
        expect(JSON.stringify(rows[0])).not.toContain("Canary Organiser");
    });

    test("a row stored before the fix is read without the organiser", async () => {
        fakeDb.col("Notifications").docs.push({
            _id: new ObjectId(),
            userId: VOLUNTEER,
            type: "task_shift_declined",
            content: {
                circle: { _id: CIRCLE_ID, handle: "secret-space", name: "The Secret Space", circleType: "circle" },
                user: { did: ORGANISER, handle: "organiser", name: "Canary Organiser", circleType: "user" },
                taskId: task._id.toString(),
                taskTitle: "Door crew",
                body: "Thanks for offering to help with Door crew.",
            },
            isRead: false,
            createdAt: new Date(),
        });
        const [row] = await listNotificationsForUser(VOLUNTEER);
        expect((row.content as Record<string, any>).user).toBeUndefined();
        expect((row.content as Record<string, any>).circle?.handle).toBe("secret-space");
        expect(JSON.stringify(row)).not.toContain(ORGANISER);
    });

    test("the admin's 'email unread notifications' shaping drops it too; other types keep their user", () => {
        const content = { user: { did: ORGANISER, name: "Canary Organiser" }, taskTitle: "Door crew" };
        expect((shapeStoredNotificationContent("task_shift_declined", content) as any).user).toBeUndefined();
        expect((shapeStoredNotificationContent("task_shift_confirmed", content) as any).user?.did).toBe(ORGANISER);
    });

    test("the bell shows the circle's picture, like the crew-joined notice", () => {
        expect(showsActorPicture("task_shift_declined")).toBe(false);
        expect(showsActorPicture("crew_application_approved")).toBe(false);
        // The others keep the person who acted.
        expect(showsActorPicture("task_shift_confirmed")).toBe(true);
        expect(showsActorPicture("task_shift_signup")).toBe(true);
        expect(showsActorPicture("post_comment")).toBe(true);
    });
});
