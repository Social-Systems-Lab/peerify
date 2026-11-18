// Run: IS_BUILD=true bun test src/components/modules/tasks/shift-date-labels.test.tsx
// Shift dates 3/5 (2026-11-18): every shift date label is the calendar date in the shift's zone and
// the wall-clock times as stored, the same on the server (Europe/Stockholm on staging) and in any
// browser. Door crew: Sun 6 Dec, 18:00–20:00 in Cape Town, picked there (2026-12-05T22:00:00Z).
// Covers the Home page's "Upcoming shifts" panel (rendered), the shifts list's date and time columns,
// and the shift and task page's date (formatters in shift-task-utils). The Crew panel is in
// src/components/modules/crew/shift-date-tz-render.test.tsx.

import { afterAll, describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TaskDisplay } from "@/models/models";
import { UpcomingShiftsPanel } from "@/components/modules/home/upcoming-shifts-panel";
import * as utils from "./shift-task-utils";

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
    process.env.TZ = ORIGINAL_TZ;
});
const inZone = <T,>(tz: string, run: () => T): T => {
    const before = process.env.TZ;
    process.env.TZ = tz;
    try {
        return run();
    } finally {
        process.env.TZ = before;
    }
};
const ZONES = ["Europe/Stockholm", "Africa/Johannesburg", "America/New_York"];

const doorCrew = {
    _id: "door",
    circleId: "c",
    createdBy: "did:test:org",
    title: "Door crew",
    taskType: "shift",
    stage: "open",
    slots: 2,
    shiftStartTime: "18:00",
    shiftDurationMinutes: 120,
    targetDate: new Date("2026-12-05T22:00:00.000Z"),
    participants: [],
} as unknown as TaskDisplay;

type Formatter = (task: TaskDisplay) => string;
const formatter = (name: string): Formatter => {
    const fn = (utils as unknown as Record<string, unknown>)[name];
    if (typeof fn !== "function") throw new Error(`shift-task-utils has no ${name}`);
    return fn as Formatter;
};

describe("Home: 'Upcoming shifts' panel", () => {
    const render = () =>
        renderToStaticMarkup(<UpcomingShiftsPanel circleHandle="venue" shifts={[doorCrew]} visibility="visible" />);
    for (const tz of ZONES) {
        test(`rendered in ${tz}: "Sun, 6 Dec · 6:00 PM - 8:00 PM"`, () => {
            expect(inZone(tz, render)).toContain("Sun, 6 Dec · 6:00 PM - 8:00 PM");
        });
    }
    test("server (Stockholm) and browser (Cape Town) markup are identical", () => {
        expect(inZone("Europe/Stockholm", render)).toBe(inZone("Africa/Johannesburg", render));
    });
});

describe("Shifts list: date and time columns", () => {
    for (const tz of ZONES) {
        test(`in ${tz}`, () => {
            expect(inZone(tz, () => formatter("formatShiftListDate")(doorCrew))).toBe("Sun 6 Dec 2026");
            expect(inZone(tz, () => formatter("formatShiftListTime")(doorCrew))).toBe("18:00");
        });
    }
    test("no date or time", () => {
        const bare = { ...doorCrew, targetDate: undefined, shiftStartTime: undefined } as unknown as TaskDisplay;
        expect(formatter("formatShiftListDate")(bare)).toBe("No date");
        expect(formatter("formatShiftListTime")(bare)).toBe("No time");
    });
});

describe("Shift and task page: the date", () => {
    for (const tz of ZONES) {
        test(`in ${tz}: "December 6th, 2026"`, () => {
            expect(inZone(tz, () => formatter("formatTargetDateLong")(doorCrew))).toBe("December 6th, 2026");
        });
    }
    test("not set", () => {
        expect(formatter("formatTargetDateLong")({ ...doorCrew, targetDate: undefined } as TaskDisplay)).toBe(
            "Not set",
        );
    });
});
