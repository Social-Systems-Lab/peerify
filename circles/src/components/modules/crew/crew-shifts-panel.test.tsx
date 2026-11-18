// Run: IS_BUILD=true bun test src/components/modules/crew/crew-shifts-panel.test.tsx
// Crew round 2, commit 7 (2026-11-18): the "Shifts & tasks" panel at the top of the Crew page's left
// column (F7). "My shifts" always shows; "Open shifts" by event shows the next 5 rows with "Show all".
// Rows: title (linking to the shift or task page; sign-up stays there), when, the viewer's status, and
// places left counting confirmed only (F3). Organisers (moderators included, F6) also get "Review
// sign-ups" with names. Who gets the data at all is tested in crew-shifts-action.test.ts.

import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { default: CrewShiftsPanel } = await import("./crew-shifts-panel");
type Result = Parameters<typeof CrewShiftsPanel>[0]["data"];

const EVENT = { id: "e1", title: "Home show", startAt: "2026-12-06T17:00:00.000Z" };
const shift = (id: string, extra: Record<string, unknown> = {}) => ({
    kind: "shift" as const,
    id,
    title: `Shift ${id}`,
    eventId: "e1",
    targetDate: "2026-12-06T00:00:00.000Z",
    shiftStartTime: "18:00",
    shiftDurationMinutes: 120,
    slots: 2,
    confirmedCount: 1,
    openPlaces: 1,
    crewOnly: true,
    viewerStatus: null,
    ...extra,
});
const task = (id: string, extra: Record<string, unknown> = {}) => ({
    kind: "task" as const,
    id,
    title: `Task ${id}`,
    eventId: "e1",
    targetDate: "2026-12-06T00:00:00.000Z",
    stage: "open" as const,
    viewerStatus: null,
    ...extra,
});
const base: Result = { show: true, isOrganiser: false, myShifts: [], openByEvent: [] };
const render = (data: Result) => renderToStaticMarkup(<CrewShiftsPanel circleHandle="venue" data={data} />);

describe("the Crew page panel", () => {
    test("nothing at all when show is false", () => {
        expect(render({ ...base, show: false })).toBe("");
    });

    test("'My shifts' always shows, with an empty note", () => {
        const html = render(base);
        expect(html).toContain("Shifts &amp; tasks");
        expect(html).toContain("My shifts");
        expect(html).toContain("You haven&#x27;t signed up for anything coming up.");
        expect(html).toContain("No open shifts right now.");
    });

    test("my shifts with status badges and links to the shift and task pages", () => {
        const html = render({
            ...base,
            myShifts: [
                shift("s1", { viewerStatus: "pending" }),
                shift("s2", { viewerStatus: "confirmed" }),
                shift("s3", { viewerStatus: "waitingList", openPlaces: 0, confirmedCount: 2 }),
                task("t1", { viewerStatus: "claimPending" }),
                task("t2", { viewerStatus: "assigned", stage: "inProgress" }),
            ],
        });
        expect(html).toContain("You: pending");
        expect(html).toContain("You: confirmed");
        expect(html).toContain("You: waiting list");
        expect(html).toContain("You: offered");
        expect(html).toContain("You: assigned");
        expect(html).toContain('href="/circles/venue/shifts/s1"');
        expect(html).toContain('href="/circles/venue/tasks/t1"');
    });

    test("open shifts under the event's heading, F3 places label, 'Offer to help' for tasks", () => {
        const html = render({
            ...base,
            openByEvent: [
                { event: EVENT, shifts: [shift("s1")], tasks: [task("t1")] },
                { event: null, shifts: [shift("s9", { eventId: undefined })], tasks: [] },
            ],
        });
        expect(html).toContain("Home show");
        expect(html).toContain("Other shifts");
        expect(html).toContain("2 places · 1 left");
        expect(html).toContain("Offer to help");
        expect(html).not.toContain("pending");
    });

    test("only the next 5 open rows, then 'Show all'", () => {
        const shifts = ["a", "b", "c", "d", "e", "f", "g"].map((id) => shift(id));
        const html = render({ ...base, openByEvent: [{ event: EVENT, shifts, tasks: [] }] });
        expect(html).toContain("Shift e");
        expect(html).not.toContain("Shift f");
        expect(html).toContain("Show all (7)");
    });

    test("crew: no 'Review sign-ups' section", () => {
        expect(render(base)).not.toContain("Review sign-ups");
    });

    test("organisers: 'Review sign-ups' with names, pending counts and a Review link", () => {
        const html = render({
            ...base,
            isOrganiser: true,
            allByEvent: [
                {
                    event: EVENT,
                    shifts: [
                        shift("s1", {
                            confirmedCount: 2,
                            openPlaces: 0,
                            pendingCount: 1,
                            people: [
                                { did: "a", name: "Ada", status: "confirmed" },
                                { did: "b", name: "Bo", status: "confirmed" },
                                { did: "c", name: "Cy", status: "pending" },
                            ],
                        }),
                    ],
                    tasks: [task("t1", { pendingClaimCount: 2 })],
                },
            ],
        });
        expect(html).toContain("Review sign-ups");
        expect(html).toContain("Ada");
        expect(html).toContain("Cy");
        expect(html).toContain("1 pending");
        expect(html).toContain("2 places · all confirmed");
        expect(html).toContain("2 offers");
        expect(html).toContain("Review");
    });
});
