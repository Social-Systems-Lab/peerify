// Shift and task dates as calendar dates in one time zone (fix of 2026-11-18). A shift's targetDate
// is a CALENDAR DATE and its shiftStartTime a WALL-CLOCK time, both where the shift happens. Nothing
// stored carries a zone, so every reader used its own: the server (Europe/Stockholm on staging) put
// Door crew (Sun 6 Dec, picked in Cape Town = 2026-12-05T22:00Z) on Sat 5 Dec, a day early, while the
// browser said Sun 6 Dec. Every reader now goes through this module with one explicit zone.
//
// - Reading: the calendar date of the stored instant IN THE ZONE. That reads every value already
//   stored correctly: local-midnight picks from Cape Town (22:00Z) or Sweden (23:00Z), event start
//   instants, and the new 12:00Z values. No data migration.
// - Writing: the form sends "YYYY-MM-DD"; the server stores 12:00 UTC of that day (toStoredCalendarDate),
//   the same calendar day in every zone from UTC-11 to UTC+11.
// - Formatting: date-fns on a "floating" local Date built from the calendar parts, so the text is the
//   same on the server and in any browser (no hydration flip).
// Intl only (no time-zone library); works the same in Node and browsers. Per-circle zones come later
// (Tim, 2026-11-18): callers take `timeZone` with DEFAULT_TIME_ZONE as the default.

import { format } from "date-fns";

export const DEFAULT_TIME_ZONE = "Africa/Johannesburg";

// "2026-12-06"
export type CalendarDate = string;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const toValidDate = (value: unknown): Date | null => {
    if (value === null || value === undefined || value === "") return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const partsFormatter = (timeZone: string) => {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat("en-US", {
            timeZone,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
        formatters.set(timeZone, formatter);
    }
    return formatter;
};

// The wall-clock parts of an instant in a zone.
const zonedParts = (instant: Date, timeZone: string) => {
    const parts: Record<string, number> = {};
    for (const part of partsFormatter(timeZone).formatToParts(instant)) {
        if (part.type !== "literal") parts[part.type] = Number(part.value);
    }
    return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour === 24 ? 0 : parts.hour,
        minute: parts.minute,
        second: parts.second,
    };
};

// How far the zone is ahead of UTC at that instant, in ms.
const zoneOffsetMs = (instant: Date, timeZone: string) => {
    const p = zonedParts(instant, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

const pad = (n: number) => String(n).padStart(2, "0");

const parseCalendarDate = (value: CalendarDate) => {
    const match = CALENDAR_DATE.exec(value);
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
        return null;
    }
    return { year, month, day };
};

export const isCalendarDate = (value: unknown): value is CalendarDate =>
    typeof value === "string" && parseCalendarDate(value) !== null;

// The calendar date of a stored targetDate (or any instant) in the zone.
export const calendarDateOf = (value: unknown, timeZone: string = DEFAULT_TIME_ZONE): CalendarDate | null => {
    if (isCalendarDate(value)) return value;
    const date = toValidDate(value);
    if (!date) return null;
    const p = zonedParts(date, timeZone);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

// The instant at which the zone's wall clock shows that date and time ("18:00").
export const zonedInstant = (date: CalendarDate, time: string, timeZone: string = DEFAULT_TIME_ZONE): Date | null => {
    const day = parseCalendarDate(date);
    const clock = WALL_TIME.exec(time.trim());
    if (!day || !clock) return null;
    const wallAsUtc = Date.UTC(day.year, day.month - 1, day.day, Number(clock[1]), Number(clock[2]));
    // Two passes settle daylight-saving changes between the guess and the answer.
    let instant = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), timeZone);
    instant = wallAsUtc - zoneOffsetMs(new Date(instant), timeZone);
    return new Date(instant);
};

export const addCalendarDays = (date: CalendarDate, days: number): CalendarDate | null => {
    const day = parseCalendarDate(date);
    if (!day) return null;
    const next = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
    return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

// The last moment of that calendar day in the zone (a task due that day is "over" after it).
export const endOfCalendarDay = (date: CalendarDate, timeZone: string = DEFAULT_TIME_ZONE): Date | null => {
    const next = addCalendarDays(date, 1);
    const start = next ? zonedInstant(next, "00:00", timeZone) : null;
    return start ? new Date(start.getTime() - 1) : null;
};

// What the server stores for a calendar date: 12:00 UTC of that day.
export const toStoredCalendarDate = (date: CalendarDate): Date | null => {
    const day = parseCalendarDate(date);
    return day ? new Date(Date.UTC(day.year, day.month - 1, day.day, 12)) : null;
};

// A local Date (noon, in whatever zone this runs) showing that calendar day: for date pickers and
// date-fns formatting. Its local getters give the calendar parts in every zone.
export const toFloatingDate = (date: CalendarDate): Date | null => {
    const day = parseCalendarDate(date);
    return day ? new Date(day.year, day.month - 1, day.day, 12) : null;
};

// The calendar day a local Date shows (a date picker's value) as "YYYY-MM-DD".
export const calendarDateOfFloating = (date: Date): CalendarDate =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// A stored targetDate formatted with a date-fns pattern of DATE parts only ("EEE d MMM", "PPP").
export const formatCalendarDate = (
    value: unknown,
    pattern: string,
    timeZone: string = DEFAULT_TIME_ZONE,
): string | null => {
    const date = calendarDateOf(value, timeZone);
    const floating = date ? toFloatingDate(date) : null;
    return floating ? format(floating, pattern) : null;
};

// A wall-clock "HH:MM" formatted with a date-fns time pattern ("h:mm a"), plus optional minutes.
export const formatWallTime = (time: string | undefined, pattern: string, addMinutes = 0): string | null => {
    const clock = time ? WALL_TIME.exec(time.trim()) : null;
    if (!clock) return null;
    const total = (Number(clock[1]) * 60 + Number(clock[2]) + addMinutes) % (24 * 60);
    const floating = new Date(2000, 0, 1, Math.floor(total / 60), total % 60);
    return format(floating, pattern);
};

// Accepts what the task form sends for targetDate: "YYYY-MM-DD" (stored as 12:00 UTC), or, from
// forms loaded before this change, an ISO datetime (stored as its calendar date in the zone).
export const parseTargetDateInput = (raw: string, timeZone: string = DEFAULT_TIME_ZONE): Date | null => {
    const value = raw.trim();
    if (isCalendarDate(value)) return toStoredCalendarDate(value);
    const date = calendarDateOf(value, timeZone);
    return date ? toStoredCalendarDate(date) : null;
};
