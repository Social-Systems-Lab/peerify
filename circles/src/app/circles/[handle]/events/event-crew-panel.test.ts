// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/event-crew-panel.test.ts"
// Crew R1, item 3 (2026-11-14): the event page's crew panel (getEventCrewPanelAction). Shifts linked
// to the event with time, slots, confirmed and pending counts and the viewer's own status; who
// signed up for organisers only; tasks with stage and assignee. Audiences still apply (a crew-only
// shift is invisible to a follower), and the panel never carries a shift's location or participant
// note. Hidden for signed-out visitors, for viewers who can't see the event, and when the host has
// neither Tasks nor Shifts on. The database is in-memory fakes; the session and permission checks
// are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const HOST_ID = "64e000000000000000000001";
const EVENT_ID = "64e0000000000000000000e1";
const CREW_EVENT_ID = "64e0000000000000000000e2";
const ORGANISER = "did:test:organiser";
const PENDING = "did:test:pending";
const CONFIRMED = "did:test:confirmed";
const FOLLOWER = "did:test:follower";

const STREET = "Canary Street 12";
const PARTICIPANT_NOTE = "CANARY: door code 4711";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, _circleId: string, feature: unknown) => {
        if (feature === features.events.view || feature === features.tasks.view) return true;
        if (
            feature === features.tasks.moderate ||
            feature === features.tasks.assign ||
            feature === features.tasks.create ||
            feature === features.events.moderate
        ) {
            return did === ORGANISER;
        }
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getEventCrewPanelAction } = await import("./actions");

const future = (days: number) => new Date(Date.now() + days * 86_400_000);
const event = (id: string, userGroups: string[]) => ({
    _id: new ObjectId(id),
    circleId: HOST_ID,
    title: "Home show",
    stage: "open",
    visibility: "public",
    createdBy: ORGANISER,
    startAt: future(20),
    endAt: future(20),
    userGroups,
    location: { precision: 2, city: "Stockholm", country: "Sweden" },
});

const location = {
    precision: 4,
    city: "Stockholm",
    country: "Sweden",
    street: STREET,
    lngLat: { lng: 18.07, lat: 59.33 },
};
const shift = (id: string, title: string, userGroups: string[], start: string, participants: object[]) => ({
    _id: id,
    circleId: HOST_ID,
    eventId: EVENT_ID,
    createdBy: ORGANISER,
    taskType: "shift",
    title,
    stage: "open",
    userGroups,
    slots: 3,
    shiftStartTime: start,
    shiftDurationMinutes: 120,
    targetDate: new Date("2026-12-05T00:00:00Z"),
    location,
    participantNotes: PARTICIPANT_NOTE,
    participants,
    author: { did: ORGANISER, handle: "organiser", name: "Organiser" },
});
const tasks = () => [
    shift("64e0000000000000000000a2", "Bar", ["admins", "moderators", "crew"], "19:00", [
        { userDid: PENDING, joinedAt: new Date() },
        { userDid: CONFIRMED, joinedAt: new Date(), verifiedAt: new Date(), verifiedBy: ORGANISER },
    ]),
    shift("64e0000000000000000000a1", "Set-up", ["everyone"], "16:00", []),
    {
        _id: "64e0000000000000000000b1",
        circleId: HOST_ID,
        eventId: EVENT_ID,
        createdBy: ORGANISER,
        taskType: "outcome",
        title: "Borrow chairs",
        stage: "open",
        userGroups: ["everyone"],
        assignedTo: CONFIRMED,
        assignee: { did: CONFIRMED, handle: "confirmed", name: "Confirmed Person" },
        author: { did: ORGANISER, handle: "organiser", name: "Organiser" },
    },
];

const seed = (enabledModules: string[]) => {
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(HOST_ID),
                did: "did:test:host",
                handle: "host",
                name: "Host",
                circleType: "circle",
                publishStatus: "published",
                enabledModules,
            },
            { _id: new ObjectId(), did: PENDING, handle: "pending", name: "Pending Person", circleType: "user" },
            { _id: new ObjectId(), did: CONFIRMED, handle: "confirmed", name: "Confirmed Person", circleType: "user" },
        ],
        Members: [
            { userDid: ORGANISER, circleId: HOST_ID, userGroups: ["admins", "members"] },
            { userDid: PENDING, circleId: HOST_ID, userGroups: ["crew", "members"] },
            { userDid: CONFIRMED, circleId: HOST_ID, userGroups: ["crew", "members"] },
            { userDid: FOLLOWER, circleId: HOST_ID, userGroups: ["members"] },
        ],
    });
    fakeDb.setAggregateResult("Events", [event(EVENT_ID, ["everyone"]), event(CREW_EVENT_ID, ["crew"])], {
        applyLeadingMatch: true,
    });
    fakeDb.setAggregateResult("Tasks", tasks(), { applyLeadingMatch: true });
};

beforeEach(() => {
    sessionDid = undefined;
    seed(["events", "tasks", "shifts"]);
});

const panelFor = async (did: string | undefined, eventId = EVENT_ID) => {
    sessionDid = did;
    const panel = await getEventCrewPanelAction("host", eventId);
    return { panel, text: JSON.stringify(panel) };
};

describe("organisers", () => {
    test("see every shift in time order, counts, and who signed up with their status", async () => {
        const { panel } = await panelFor(ORGANISER);
        expect(panel.show).toBe(true);
        expect(panel.isOrganiser).toBe(true);
        expect(panel.canCreateShift).toBe(true);
        expect(panel.shifts.map((s) => s.title)).toEqual(["Set-up", "Bar"]);
        const bar = panel.shifts.find((s) => s.title === "Bar")!;
        expect([bar.slots, bar.confirmedCount, bar.pendingCount, bar.crewOnly]).toEqual([3, 1, 1, true]);
        expect(bar.people?.map((p) => [p.name, p.status])).toEqual([
            ["Pending Person", "pending"],
            ["Confirmed Person", "confirmed"],
        ]);
        expect(panel.tasks.map((t) => [t.title, t.stage, t.assigneeName])).toEqual([
            ["Borrow chairs", "open", "Confirmed Person"],
        ]);
    });
});

describe("crew and followers", () => {
    test("a pending sign-up sees their own status and the counts, not who else signed up", async () => {
        const { panel, text } = await panelFor(PENDING);
        expect(panel.isOrganiser).toBe(false);
        expect(panel.canCreateShift).toBe(false);
        const bar = panel.shifts.find((s) => s.title === "Bar")!;
        expect(bar.viewerStatus).toBe("pending");
        expect(bar.confirmedCount).toBe(1);
        expect(bar.people).toBeUndefined();
        expect(text).not.toContain('Confirmed Person","status');
        expect(text).not.toContain(CONFIRMED);
    });

    test("a confirmed participant sees 'confirmed'", async () => {
        const { panel } = await panelFor(CONFIRMED);
        expect(panel.shifts.find((s) => s.title === "Bar")?.viewerStatus).toBe("confirmed");
    });

    test("a follower who isn't Crew doesn't see the crew-only shift", async () => {
        const { panel } = await panelFor(FOLLOWER);
        expect(panel.show).toBe(true);
        expect(panel.shifts.map((s) => s.title)).toEqual(["Set-up"]);
    });

    test("nobody gets a shift's location or participant note through the panel", async () => {
        for (const did of [ORGANISER, PENDING, CONFIRMED, FOLLOWER]) {
            const { text } = await panelFor(did);
            expect(text).not.toContain(STREET);
            expect(text).not.toContain(PARTICIPANT_NOTE);
        }
    });
});

describe("when the panel is hidden", () => {
    test("signed out", async () => {
        const { panel } = await panelFor(undefined);
        expect(panel.show).toBe(false);
        expect(panel.shifts).toEqual([]);
    });

    test("the viewer can't see the event (a crew-only event, for a follower)", async () => {
        const { panel } = await panelFor(FOLLOWER, CREW_EVENT_ID);
        expect(panel.show).toBe(false);
    });

    test("the host has neither Tasks nor Shifts on", async () => {
        seed(["events"]);
        const { panel } = await panelFor(ORGANISER);
        expect(panel.show).toBe(false);
    });

    test("a follower who isn't Crew, and every linked shift and task is crew-only: no panel", async () => {
        fakeDb.setAggregateResult(
            "Tasks",
            tasks().map((t) => ({ ...t, userGroups: ["admins", "moderators", "crew"] })),
            {
                applyLeadingMatch: true,
            },
        );
        const { panel } = await panelFor(FOLLOWER);
        expect(panel.show).toBe(false);
        expect(panel.shifts).toEqual([]);
        expect(panel.tasks).toEqual([]);
    });

    test("no shifts or tasks linked: no panel for a follower, but still one for an organiser", async () => {
        fakeDb.setAggregateResult("Tasks", [], { applyLeadingMatch: true });
        expect((await panelFor(FOLLOWER)).panel.show).toBe(false);
        const { panel } = await panelFor(ORGANISER);
        expect(panel.show).toBe(true);
        expect(panel.canCreateShift).toBe(true);
    });

    test("only Tasks on: no shifts, no Create shift", async () => {
        seed(["events", "tasks"]);
        const { panel } = await panelFor(ORGANISER);
        expect(panel.shifts).toEqual([]);
        expect(panel.canCreateShift).toBe(false);
        expect(panel.tasks.map((t) => t.title)).toEqual(["Borrow chairs"]);
    });
});
