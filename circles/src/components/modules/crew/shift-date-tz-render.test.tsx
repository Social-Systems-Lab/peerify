// Run: IS_BUILD=true bun test src/components/modules/crew/shift-date-tz-render.test.tsx
// Shift dates and time zones (staging bug, 2026-11-18): the Crew page's "Shifts & tasks" panel is a
// client component, so it renders twice: on the server (Europe/Stockholm) and again in the browser.
// The two must print the same date, or the row flips from "Sat 5 Dec" to "Sun 6 Dec" on hydration.
// FAILING FIRST: see src/lib/tasks/shift-date-tz.test.ts for the proposed rule.

import { afterAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { default: CrewShiftsPanel } = await import("./crew-shifts-panel");
type Result = Parameters<typeof CrewShiftsPanel>[0]["data"];

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
    process.env.TZ = ORIGINAL_TZ;
});

const PICKED_IN_CAPE_TOWN = "2026-12-05T22:00:00.000Z"; // Door crew: Sun 6 Dec, picked in Cape Town
const data: Result = {
    show: true,
    isOrganiser: false,
    myShifts: [
        {
            kind: "shift",
            id: "door",
            title: "Door crew",
            eventId: "e1",
            targetDate: PICKED_IN_CAPE_TOWN,
            shiftStartTime: "18:00",
            shiftDurationMinutes: 120,
            slots: 2,
            confirmedCount: 0,
            openPlaces: 2,
            crewOnly: true,
            viewerStatus: "pending",
        },
        {
            kind: "task",
            id: "posters",
            title: "Put up posters",
            eventId: "e1",
            targetDate: PICKED_IN_CAPE_TOWN,
            stage: "open",
            viewerStatus: "claimPending",
        },
    ],
    // The event's own startAt is a real instant (17:00 SAST): its heading is fine in any zone that
    // is on the same day, so it isn't part of this bug.
    openByEvent: [],
};

const renderIn = (tz: string) => {
    const before = process.env.TZ;
    process.env.TZ = tz;
    try {
        return renderToStaticMarkup(<CrewShiftsPanel circleHandle="venue" data={data} />);
    } finally {
        process.env.TZ = before;
    }
};

describe("the panel prints the same dates on the server and in the browser", () => {
    for (const tz of ["Europe/Stockholm", "Africa/Johannesburg", "America/New_York"]) {
        test(`rendered in ${tz}: Door crew and the task both say Sun 6 Dec`, () => {
            const html = renderIn(tz);
            expect(html).toContain("Sun 6 Dec · 18:00–20:00");
            expect(html).toContain(">Sun 6 Dec<");
            expect(html).not.toContain("Sat 5 Dec");
        });
    }

    test("server (Stockholm) and browser (Cape Town) markup are identical", () => {
        expect(renderIn("Europe/Stockholm")).toBe(renderIn("Africa/Johannesburg"));
    });
});
