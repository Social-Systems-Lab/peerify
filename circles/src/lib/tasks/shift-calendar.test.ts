// Run: IS_BUILD=true bun test src/lib/tasks/shift-calendar.test.ts
// The calendar-date helpers behind the shift date fix (2026-11-18): reading stored targetDates as a
// calendar date in one zone, wall-clock times to real instants (daylight saving included), what the
// server stores for a picked day, and formatting that doesn't depend on the zone the code runs in.

import { afterAll, describe, expect, test } from "bun:test";
import {
    calendarDateOf,
    DEFAULT_TIME_ZONE,
    endOfCalendarDay,
    formatCalendarDate,
    formatWallTime,
    parseTargetDateInput,
    toFloatingDate,
    calendarDateOfFloating,
    toStoredCalendarDate,
    zonedInstant,
} from "./shift-calendar";

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
const ZONES = ["Europe/Stockholm", "UTC", "Africa/Johannesburg", "America/New_York", "Pacific/Auckland"];

test("the default zone is Africa/Johannesburg", () => {
    expect(DEFAULT_TIME_ZONE).toBe("Africa/Johannesburg");
});

describe("calendarDateOf reads every stored kind as the day in the zone", () => {
    const cases: [string, string][] = [
        ["2026-12-05T22:00:00.000Z", "picked in Cape Town (local midnight SAST)"],
        ["2026-12-05T23:00:00.000Z", "picked in Sweden (local midnight CET)"],
        ["2026-12-06T16:00:00.000Z", "an event's start instant"],
        ["2026-12-06T12:00:00.000Z", "the new stored form (12:00 UTC)"],
    ];
    for (const [stored, label] of cases) {
        for (const tz of ZONES) {
            test(`${label}, running in ${tz}: 2026-12-06`, () => {
                expect(inZone(tz, () => calendarDateOf(new Date(stored)))).toBe("2026-12-06");
                expect(inZone(tz, () => calendarDateOf(stored))).toBe("2026-12-06");
            });
        }
    }
    test("a calendar date string is kept; nothing usable gives null", () => {
        expect(calendarDateOf("2026-12-06")).toBe("2026-12-06");
        expect(calendarDateOf(undefined)).toBeNull();
        expect(calendarDateOf(null)).toBeNull();
        expect(calendarDateOf("not a date")).toBeNull();
    });
});

describe("zonedInstant: wall-clock time in a zone to the real instant", () => {
    test("18:00 on 6 Dec in Cape Town is 16:00 UTC, wherever this runs", () => {
        for (const tz of ZONES) {
            expect(inZone(tz, () => zonedInstant("2026-12-06", "18:00")?.toISOString())).toBe(
                "2026-12-06T16:00:00.000Z",
            );
        }
    });
    test("daylight saving: Stockholm summer and winter, New York", () => {
        expect(zonedInstant("2026-07-01", "18:00", "Europe/Stockholm")?.toISOString()).toBe("2026-07-01T16:00:00.000Z");
        expect(zonedInstant("2026-12-01", "18:00", "Europe/Stockholm")?.toISOString()).toBe("2026-12-01T17:00:00.000Z");
        // The day the clocks go back (25 Oct 2026): 18:00 is already winter time.
        expect(zonedInstant("2026-10-25", "18:00", "Europe/Stockholm")?.toISOString()).toBe("2026-10-25T17:00:00.000Z");
        // The day the clocks go forward (29 Mar 2026): 18:00 is summer time.
        expect(zonedInstant("2026-03-29", "18:00", "Europe/Stockholm")?.toISOString()).toBe("2026-03-29T16:00:00.000Z");
        expect(zonedInstant("2026-07-04", "09:30", "America/New_York")?.toISOString()).toBe("2026-07-04T13:30:00.000Z");
    });
    test("bad input gives null", () => {
        expect(zonedInstant("2026-02-30", "18:00")).toBeNull();
        expect(zonedInstant("2026-12-06", "25:00")).toBeNull();
        expect(zonedInstant("6 Dec", "18:00")).toBeNull();
    });
});

test("endOfCalendarDay: the last moment of the day in the zone", () => {
    expect(endOfCalendarDay("2026-12-06")?.toISOString()).toBe("2026-12-06T21:59:59.999Z");
});

describe("what the server stores for a picked day", () => {
    test("12:00 UTC of that day", () => {
        expect(toStoredCalendarDate("2026-12-06")?.toISOString()).toBe("2026-12-06T12:00:00.000Z");
    });
    test("the form's 'YYYY-MM-DD', and an ISO datetime from a form loaded before the fix", () => {
        expect(parseTargetDateInput("2026-12-06")?.toISOString()).toBe("2026-12-06T12:00:00.000Z");
        expect(parseTargetDateInput("2026-12-05T22:00:00.000Z")?.toISOString()).toBe("2026-12-06T12:00:00.000Z");
        expect(parseTargetDateInput("garbage")).toBeNull();
    });
    test("the stored day reads back as the same day in every zone from UTC-11 to UTC+11", () => {
        const stored = toStoredCalendarDate("2026-12-06");
        for (const tz of [
            "Pacific/Pago_Pago",
            "America/New_York",
            "UTC",
            "Africa/Johannesburg",
            "Asia/Tokyo",
            "Pacific/Noumea",
        ]) {
            expect(calendarDateOf(stored, tz)).toBe("2026-12-06");
        }
    });
});

describe("formatting doesn't depend on the zone the code runs in", () => {
    test("formatCalendarDate", () => {
        for (const tz of ZONES) {
            expect(inZone(tz, () => formatCalendarDate(new Date("2026-12-05T22:00:00.000Z"), "EEE d MMM"))).toBe(
                "Sun 6 Dec",
            );
            expect(inZone(tz, () => formatCalendarDate("2026-12-05T22:00:00.000Z", "PPP"))).toBe("December 6th, 2026");
        }
        expect(formatCalendarDate(undefined, "PPP")).toBeNull();
    });
    test("formatWallTime", () => {
        for (const tz of ZONES) {
            expect(inZone(tz, () => formatWallTime("18:00", "h:mm a"))).toBe("6:00 PM");
            expect(inZone(tz, () => formatWallTime("23:00", "HH:mm", 120))).toBe("01:00");
        }
        expect(formatWallTime(undefined, "HH:mm")).toBeNull();
    });
    test("a date picker's local Date round-trips to the same calendar day in any zone", () => {
        for (const tz of ZONES) {
            expect(
                inZone(tz, () => {
                    const floating = toFloatingDate("2026-12-06");
                    return floating ? calendarDateOfFloating(floating) : null;
                }),
            ).toBe("2026-12-06");
        }
    });
});

// Shift dates 4/5: the task form shows the stored day in its date picker and sends the picked day.
describe("the task form's date picker", () => {
    test("pickerDateFromStored: the stored day, in a browser in any zone", async () => {
        const { pickerDateFromStored } = (await import("./shift-calendar")) as Record<string, unknown> as {
            pickerDateFromStored?: (value: unknown) => Date | undefined;
        };
        expect(typeof pickerDateFromStored).toBe("function");
        for (const tz of ZONES) {
            for (const stored of ["2026-12-05T22:00:00.000Z", "2026-12-06T16:00:00.000Z", "2026-12-06T12:00:00.000Z"]) {
                const picked = inZone(tz, () => pickerDateFromStored?.(stored));
                expect(inZone(tz, () => (picked ? calendarDateOfFloating(picked) : null))).toBe("2026-12-06");
            }
        }
        expect(pickerDateFromStored?.(undefined)).toBeUndefined();
    });
    test("parseTargetDateInput refuses anything but a calendar date or an ISO datetime", () => {
        expect(parseTargetDateInput("2026-02-30")).toBeNull();
        expect(parseTargetDateInput("12/06/2026")).toBeNull();
        expect(parseTargetDateInput("")).toBeNull();
    });
});
