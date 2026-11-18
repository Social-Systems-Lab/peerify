// Run: IS_BUILD=true bun test src/components/modules/crew/crew-shifts-action.test.ts
// Crew round 2, commit 6 (2026-11-18): getCrewShiftsAndTasksAction, the data for the Crew page's
// "Shifts & tasks" panel. Who gets it: signed-in admins, moderators and crew of that circle (the Crew
// page's own check), with Crew on and the Tasks/Shifts modules respected. What they get: tasks through
// filterTasksForViewer (audience, decision B, private pending sign-ups and claims) and events through
// shapeEventsForViewer, summarised by summarizeCrewShiftsView. No location or notes for anyone; names
// for organisers (tasks.assign / tasks.moderate, or platform admins) only.
// The database is in-memory fakes; the session is stubbed, and the permission check is "admin or
// moderator of that circle" for manager features, read from the fake Members.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE_ID = "64f800000000000000000044";
const OTHER_CIRCLE_ID = "64f800000000000000000055";
const EVENT_ID = "64f8000000000000000000a1";
const DRAFT_EVENT_ID = "64f8000000000000000000a2";
const CREW_SHIFT_ID = "64f8000000000000000000b1";
const OPEN_SHIFT_ID = "64f8000000000000000000b2";
const TASK_ID = "64f8000000000000000000b3";
const DRAFT_SHIFT_ID = "64f8000000000000000000b4";

const ADMIN = "did:test:admin";
const MODERATOR = "did:test:moderator";
const C1 = "did:test:c1";
const C2 = "did:test:c2";
const FOLLOWER = "did:test:follower";
const OTHER_ADMIN = "did:test:other-admin";
const PLATFORM_ADMIN = "did:test:platform-admin";

const CANARY_STREET = "CANARY Street 12";
const CANARY_NOTE = "CANARY door code 4711";
const DRAFT_TITLE = "CANARY secret draft event";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) => {
        if (feature === features.tasks.view || feature === features.events.view) return true;
        const groups = fakeDb.col("Members").docs.find((m) => m.userDid === did && m.circleId === String(circleId))
            ?.userGroups as string[] | undefined;
        if (!groups) return false;
        // Defaults: admins have everything; moderators have tasks.assign but not tasks.moderate.
        if (feature === features.tasks.assign) return groups.includes("admins") || groups.includes("moderators");
        return groups.includes("admins");
    },
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

const { getCrewShiftsAndTasksAction } = await import("./actions");

const DAY = 86_400_000;
const future = (days: number) => new Date(Date.now() + days * DAY);
const joined = new Date(Date.now() - 2 * DAY);
const member = (userDid: string, circleId: string, userGroups: string[]) => ({
    _id: new ObjectId(),
    circleId,
    userDid,
    userGroups,
});
const profile = (did: string, name: string) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name,
    circleType: "user",
    ...(did === PLATFORM_ADMIN ? { isAdmin: true } : {}),
});
const shiftDoc = (id: string, extra: Record<string, unknown>) => ({
    _id: new ObjectId(id),
    circleId: CIRCLE_ID,
    createdBy: ADMIN,
    taskType: "shift",
    stage: "open",
    slots: 2,
    shiftStartTime: "18:00",
    shiftDurationMinutes: 120,
    targetDate: future(10),
    eventId: EVENT_ID,
    location: { precision: 4, street: CANARY_STREET, city: "Cape Town", country: "South Africa" },
    participantNotes: CANARY_NOTE,
    participants: [],
    ...extra,
});

const seed = (circleExtra: Record<string, unknown> = {}) => {
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(CIRCLE_ID),
                did: "did:test:venue",
                handle: "venue",
                circleType: "circle",
                enabledModules: ["crew", "tasks", "shifts", "events"],
                ...circleExtra,
            },
            {
                _id: new ObjectId(OTHER_CIRCLE_ID),
                did: "did:test:other",
                handle: "other",
                circleType: "circle",
                enabledModules: ["crew", "tasks", "shifts"],
            },
            profile(C1, "Cee One"),
            profile(C2, "Cee Two"),
            profile(PLATFORM_ADMIN, "Platform Admin"),
        ],
        Members: [
            member(ADMIN, CIRCLE_ID, ["admins", "members"]),
            member(MODERATOR, CIRCLE_ID, ["moderators", "members"]),
            member(C1, CIRCLE_ID, ["crew", "members"]),
            member(C2, CIRCLE_ID, ["crew", "members"]),
            member(FOLLOWER, CIRCLE_ID, ["members"]),
            member(OTHER_ADMIN, OTHER_CIRCLE_ID, ["admins", "members"]),
            member(OTHER_ADMIN, CIRCLE_ID, ["members"]),
        ],
        Events: [
            {
                _id: new ObjectId(EVENT_ID),
                circleId: CIRCLE_ID,
                createdBy: ADMIN,
                title: "Home show",
                stage: "open",
                userGroups: ["everyone"],
                startAt: future(10),
                endAt: future(10),
                location: { street: CANARY_STREET },
            },
            {
                _id: new ObjectId(DRAFT_EVENT_ID),
                circleId: CIRCLE_ID,
                createdBy: ADMIN,
                title: DRAFT_TITLE,
                stage: "draft",
                userGroups: ["everyone"],
                startAt: future(12),
                endAt: future(12),
            },
        ],
        Tasks: [
            shiftDoc(CREW_SHIFT_ID, {
                title: "Door (crew only)",
                userGroups: ["admins", "moderators", "crew"],
                participants: [
                    { userDid: C1, joinedAt: joined },
                    { userDid: C2, joinedAt: joined },
                ],
            }),
            shiftDoc(OPEN_SHIFT_ID, { title: "Bar (everyone)", userGroups: ["everyone"], slots: 1 }),
            shiftDoc(DRAFT_SHIFT_ID, { title: "Setup", userGroups: ["everyone"], eventId: DRAFT_EVENT_ID }),
            {
                _id: new ObjectId(TASK_ID),
                circleId: CIRCLE_ID,
                createdBy: ADMIN,
                taskType: "outcome",
                title: "Bring a PA",
                stage: "open",
                userGroups: ["everyone"],
                targetDate: future(10),
                eventId: EVENT_ID,
                location: { street: CANARY_STREET },
                claims: [{ claimId: "k1", claimantDid: C2, status: "pending", createdAt: joined, note: CANARY_NOTE }],
            },
        ],
    });
    // getTasksByCircleId reads through an aggregate whose first stage matches the circle.
    fakeDb.setAggregateResult("Tasks", fakeDb.col("Tasks").docs, { applyLeadingMatch: true });
};

const run = async (did: string | undefined, handle = "venue") => {
    sessionDid = did;
    return getCrewShiftsAndTasksAction(handle);
};
const shiftTitles = (groups: { shifts: { title: string }[] }[] | undefined) =>
    (groups ?? []).flatMap((g) => g.shifts.map((s) => s.title));
const keysOf = (value: unknown, keys = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) value.forEach((v) => keysOf(v, keys));
    else if (value && typeof value === "object")
        for (const [k, v] of Object.entries(value)) {
            keys.add(k);
            keysOf(v, keys);
        }
    return keys;
};

beforeEach(() => seed());

describe("who gets the panel", () => {
    test("signed out, a follower who isn't crew, another circle's admin: nothing", async () => {
        for (const did of [undefined, FOLLOWER, OTHER_ADMIN]) {
            const result = await run(did);
            expect(result.show).toBe(false);
            expect(result.myShifts).toEqual([]);
            expect(result.openByEvent).toEqual([]);
            expect(result.allByEvent).toBeUndefined();
        }
    });

    test("another circle's admin through their own circle's handle sees only that circle (nothing here)", async () => {
        const result = await run(OTHER_ADMIN, "other");
        expect(result.show).toBe(true);
        expect(JSON.stringify(result)).not.toContain("Door");
    });

    test("a platform admin who isn't a member of the circle: nothing (the Crew page's own rule)", async () => {
        expect((await run(PLATFORM_ADMIN)).show).toBe(false);
    });

    test("Crew off: nothing, even for the circle's admin", async () => {
        seed({ enabledModules: ["tasks", "shifts", "events"] });
        expect((await run(ADMIN)).show).toBe(false);
    });

    test("Tasks and Shifts both off: no panel", async () => {
        seed({ enabledModules: ["crew", "events"] });
        expect((await run(ADMIN)).show).toBe(false);
    });

    test("Shifts module off: no shifts; Tasks module off: no tasks", async () => {
        seed({ enabledModules: ["crew", "tasks", "events"] });
        let result = await run(C1);
        expect(result.show).toBe(true);
        expect(shiftTitles(result.openByEvent)).toEqual([]);
        expect(result.myShifts).toEqual([]);
        expect(result.openByEvent.flatMap((g) => g.tasks.map((t) => t.title))).toEqual(["Bring a PA"]);

        seed({ enabledModules: ["crew", "shifts", "events"] });
        result = await run(C1);
        expect(result.openByEvent.flatMap((g) => g.tasks)).toEqual([]);
        expect(result.myShifts.map((s) => s.title)).toEqual(["Door (crew only)"]);
    });
});

describe("crew", () => {
    test("C1 sees their own pending crew-only shift under 'My shifts', and open shifts under the event", async () => {
        const result = await run(C1);
        expect(result.show).toBe(true);
        expect(result.isOrganiser).toBe(false);
        expect(result.myShifts.map((s) => [s.title, s.viewerStatus])).toEqual([["Door (crew only)", "pending"]]);
        expect(result.openByEvent.map((g) => g.event?.title ?? "Other")).toEqual(["Home show", "Other"]);
        expect(shiftTitles(result.openByEvent)).toEqual(["Bar (everyone)", "Setup"]);
    });

    test("C1 never sees C2's pending sign-up, names, or anyone's DID but their own", async () => {
        const json = JSON.stringify(await run(C1));
        expect(json).not.toContain(C2);
        expect(json).not.toContain("Cee Two");
        expect(json).not.toContain("Cee One");
        const keys = keysOf(await run(C1));
        for (const forbidden of ["people", "pendingCount", "pendingClaimCount", "allByEvent", "did"]) {
            expect(keys.has(forbidden)).toBe(false);
        }
    });

    test("a pending crew member on a crew-only shift gets no location, notes or claims (keys absent)", async () => {
        const result = await run(C1);
        const json = JSON.stringify(result);
        expect(json).not.toContain("CANARY");
        const keys = keysOf(result);
        for (const forbidden of ["location", "participantNotes", "participantNotesHidden", "claims", "participants"]) {
            expect(keys.has(forbidden)).toBe(false);
        }
    });

    test("a shift on a draft event goes under 'Other', and the draft event's title is never sent", async () => {
        const result = await run(C1);
        const other = result.openByEvent.find((g) => g.event === null);
        expect(other?.shifts.map((s) => s.title)).toEqual(["Setup"]);
        expect(JSON.stringify(result)).not.toContain(DRAFT_TITLE);
        expect(JSON.stringify(result)).not.toContain(DRAFT_EVENT_ID);
    });

    test("C2's pending claim puts the task under 'My shifts' for C2 only", async () => {
        const forC2 = await run(C2);
        expect(forC2.myShifts.some((s) => s.title === "Bring a PA" && s.viewerStatus === "claimPending")).toBe(true);
        const forC1 = await run(C1);
        expect(forC1.openByEvent.flatMap((g) => g.tasks.map((t) => t.title))).toEqual(["Bring a PA"]);
    });
});

describe("organisers", () => {
    test("the admin sees names per shift in allByEvent, and still no location or notes", async () => {
        const result = await run(ADMIN);
        expect(result.isOrganiser).toBe(true);
        const door = result.allByEvent?.flatMap((g) => g.shifts).find((s) => s.title === "Door (crew only)");
        expect(door?.people?.map((p) => [p.name, p.status])).toEqual([
            ["Cee One", "pending"],
            ["Cee Two", "pending"],
        ]);
        expect(door?.pendingCount).toBe(2);
        // (The admin manages the draft event, so its title is theirs to see; location and notes never.)
        const json = JSON.stringify(result);
        expect(json).not.toContain(CANARY_STREET);
        expect(json).not.toContain(CANARY_NOTE);
    });

    test("a moderator (tasks.assign) gets the organiser view too (F6)", async () => {
        const result = await run(MODERATOR);
        expect(result.show).toBe(true);
        expect(result.isOrganiser).toBe(true);
        expect(result.allByEvent?.length).toBeGreaterThan(0);
    });
});
