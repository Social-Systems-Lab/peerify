// Run: IS_BUILD=true bun test src/lib/tasks/task-date-labels.test.ts
// Shift dates 5/5 (2026-11-18): a task's targetDate (a due date) is a calendar date in the circle's
// zone too. "Put up posters", due Sun 6 Dec, picked in Cape Town (2026-12-05T22:00:00Z), must say
// 6 Dec on the server and in any browser: the tasks list, the event's crew panel ("due 6 Dec"), and
// the dated items in the events calendar and the user toolbox (a local Date on that day).

import { afterAll, describe, expect, test } from "bun:test";
import * as shiftTaskUtils from "@/components/modules/tasks/shift-task-utils";
import * as eventCrewPanel from "./event-crew-panel";
import * as shiftCalendar from "./shift-calendar";

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
const ZONES = ["Europe/Stockholm", "Africa/Johannesburg", "America/New_York"];
const DUE = "2026-12-05T22:00:00.000Z";

const fn = <T>(mod: unknown, name: string): T => {
    const value = (mod as Record<string, unknown>)[name];
    if (typeof value !== "function") throw new Error(`missing ${name}`);
    return value as T;
};

describe("a task due Sun 6 Dec", () => {
    for (const tz of ZONES) {
        test(`tasks list, in ${tz}: "6 Dec 2026"`, () => {
            const format = fn<(value?: Date | string | null) => string>(shiftTaskUtils, "formatTaskListDate");
            expect(inZone(tz, () => format(new Date(DUE)))).toBe("6 Dec 2026");
        });
        test(`event crew panel, in ${tz}: "due 6 Dec"`, () => {
            const format = fn<(task: { targetDate?: string }) => string>(eventCrewPanel, "formatTaskDue");
            expect(inZone(tz, () => format({ targetDate: DUE }))).toBe(" · due 6 Dec");
        });
        test(`events calendar and toolbox, in ${tz}: a local Date on 6 Dec`, () => {
            const floating = fn<(value: unknown) => Date | undefined>(shiftCalendar, "floatingDateOf");
            const date = inZone(tz, () => floating(DUE));
            expect(inZone(tz, () => [date?.getFullYear(), date?.getMonth(), date?.getDate()])).toEqual([2026, 11, 6]);
        });
    }
    test("no date", () => {
        expect(fn<(value?: Date | null) => string>(shiftTaskUtils, "formatTaskListDate")(null)).toBe("No due date");
        expect(fn<(task: { targetDate?: string }) => string>(eventCrewPanel, "formatTaskDue")({})).toBe("");
    });
});
