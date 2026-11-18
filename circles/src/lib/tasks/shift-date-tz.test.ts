// Run: IS_BUILD=true bun test src/lib/tasks/shift-date-tz.test.ts
// Shift dates and time zones (staging bug, 2026-11-18). Door crew (6 Dec, 18:00, Cape Town) showed as
// "Sat 5 Dec" while the Crew page loaded (server render, Europe/Stockholm), then "Sun 6 Dec" after
// hydration (a browser in Cape Town). Its targetDate was picked in the form's calendar in Cape Town:
// local midnight SAST, 2026-12-05T22:00:00Z. The date and the start time are read in whatever zone
// the code runs in, so the server and the browser disagree, and the server places the shift ~a day early.
//
// FAILING FIRST: these describe the proposed fix. A shift's date and wall-clock start time belong to
// the circle's zone (proposed default Africa/Johannesburg until circles carry their own zone), and
// labels, start/end and "is it over" must not depend on the process zone (server or browser).

import { afterAll, describe, expect, test } from "bun:test";
import type { TaskDisplay } from "@/models/models";
import { formatShiftWhen } from "./event-crew-panel";
import { getShiftEndAt, getShiftStartAt } from "@/components/modules/tasks/shift-task-utils";
import { summarizeCrewShiftsView } from "./crew-shifts-view";

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
    process.env.TZ = ORIGINAL_TZ;
});
const inZone = <T>(tz: string, run: () => T): T => {
    const before = process.env.TZ;
    process.env.TZ = tz;
    try {
        return run();
    } finally {
        process.env.TZ = before;
    }
};

// The three ways a shift's targetDate gets written today (task-form.tsx sends toISOString()):
const PICKED_IN_CAPE_TOWN = "2026-12-05T22:00:00.000Z"; // calendar pick, local midnight SAST (Door crew)
const PICKED_IN_SWEDEN = "2026-12-05T23:00:00.000Z"; // calendar pick, local midnight CET
const FROM_EVENT_START = "2026-12-06T16:00:00.000Z"; // prefilled from the event's startAt (18:00 SAST)
const TRUE_START = "2026-12-06T16:00:00.000Z"; // 18:00 SAST on Sun 6 Dec
const TRUE_END = "2026-12-06T18:00:00.000Z";

const ZONES = ["Europe/Stockholm", "UTC", "Africa/Johannesburg", "America/New_York"];
const STORED = { PICKED_IN_CAPE_TOWN, PICKED_IN_SWEDEN, FROM_EVENT_START };
const schedule = (targetDate: string) => ({ targetDate, shiftStartTime: "18:00", shiftDurationMinutes: 120 });

describe("the shift's date label is the same on the server and in any browser", () => {
    for (const [name, stored] of Object.entries(STORED)) {
        for (const tz of ZONES) {
            test(`${name}, rendered in ${tz}: "Sun 6 Dec · 18:00–20:00"`, () => {
                expect(inZone(tz, () => formatShiftWhen(schedule(stored)))).toBe("Sun 6 Dec · 18:00–20:00");
            });
        }
    }
});

describe("start and end are the real instants, wherever the code runs", () => {
    for (const [name, stored] of Object.entries(STORED)) {
        for (const tz of ZONES) {
            test(`${name}, computed in ${tz}`, () => {
                const task = schedule(stored) as unknown as Parameters<typeof getShiftEndAt>[0];
                const [start, end] = inZone(tz, () => [getShiftStartAt(task), getShiftEndAt(task)]);
                expect(start?.toISOString()).toBe(TRUE_START);
                expect(end?.toISOString()).toBe(TRUE_END);
            });
        }
    }
});

describe("the Crew page view on a server in Europe/Stockholm", () => {
    const ME = "did:test:me";
    const event = { _id: "e1", title: "Home show", startAt: new Date("2026-12-06T15:00:00Z") };
    const doorCrew = {
        _id: "door",
        circleId: "c",
        createdBy: "did:test:org",
        title: "Door crew",
        taskType: "shift",
        stage: "open",
        userGroups: ["admins", "moderators", "crew"],
        slots: 2,
        ...schedule(PICKED_IN_CAPE_TOWN),
        targetDate: new Date(PICKED_IN_CAPE_TOWN),
        eventId: "e1",
        participants: [{ userDid: ME, joinedAt: new Date("2026-12-01T10:00:00Z") }],
    } as unknown as TaskDisplay;
    const openDoorCrew = { ...doorCrew, _id: "door2", participants: [] } as unknown as TaskDisplay;
    // A task due Sun 6 Dec, picked in Cape Town.
    const posters = {
        _id: "posters",
        circleId: "c",
        createdBy: "did:test:org",
        title: "Put up posters",
        taskType: "outcome",
        stage: "open",
        userGroups: ["everyone"],
        targetDate: new Date(PICKED_IN_CAPE_TOWN),
        eventId: "e1",
        claims: [{ claimantDid: ME, status: "pending", createdAt: new Date("2026-12-01T10:00:00Z") }],
    } as unknown as TaskDisplay;

    const view = (now: string) =>
        inZone("Europe/Stockholm", () =>
            summarizeCrewShiftsView([doorCrew, openDoorCrew, posters], [event], {
                viewerDid: ME,
                isOrganiser: false,
                now: new Date(now),
            }),
        );

    test("Sat 5 Dec, 21:00 in Cape Town: Door crew is still upcoming (mine and open)", () => {
        const result = view("2026-12-05T19:00:00Z");
        expect(result.myShifts.map((item) => item.id)).toContain("door");
        expect(result.openByEvent.flatMap((group) => group.shifts.map((s) => s.id))).toContain("door2");
    });

    test("Sun 6 Dec: open at 17:30 in Cape Town; at 18:30 started (no longer open, still mine)", () => {
        const result = view("2026-12-06T15:30:00Z");
        expect(result.openByEvent.flatMap((group) => group.shifts.map((s) => s.id))).toContain("door2");
        const later = view("2026-12-06T16:30:00Z");
        expect(later.openByEvent.flatMap((group) => group.shifts.map((s) => s.id))).not.toContain("door2");
        expect(later.myShifts.map((item) => item.id)).toContain("door");
    });

    test("a task due Sun 6 Dec is still in 'My shifts' at noon on 6 Dec", () => {
        const result = view("2026-12-06T10:00:00Z");
        expect(result.myShifts.map((item) => item.id)).toContain("posters");
    });
});
