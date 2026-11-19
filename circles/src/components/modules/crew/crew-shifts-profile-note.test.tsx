// Run: IS_BUILD=true bun test src/components/modules/crew/crew-shifts-profile-note.test.tsx
// Staging round fixes (2026-11-19): a moderator or admin whose profile isn't verified, but whom the
// circle's access rules give Assign or Moderate Tasks, sees "complete your profile" where "Review
// sign-ups" would be, on the Crew page and on the Crew Dashboard. Nobody else sees it.

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

const NOTE = "To review sign-ups, complete your profile";
const base: Result = { show: true, isOrganiser: false, myShifts: [], openByEvent: [] };
const render = (data: Result, variant?: "crewPage" | "dashboard") =>
    renderToStaticMarkup(<CrewShiftsPanel circleHandle="secret-space" data={data} variant={variant} />);

describe("Shifts & tasks panel: complete your profile to review sign-ups", () => {
    test("Crew page: shown with the flag, with a link to complete the profile", () => {
        const html = render({ ...base, organiserNeedsVerifiedProfile: true });
        expect(html).toContain("Review sign-ups");
        expect(html).toContain(NOTE);
        expect(html).toContain('href="/onboarding/pilot"');
    });

    test("Crew Dashboard: shown with the flag", () => {
        const html = render({ ...base, organiserNeedsVerifiedProfile: true }, "dashboard");
        expect(html).toContain(NOTE);
    });

    test("crew without the flag: no note and no Review sign-ups", () => {
        const html = render(base);
        expect(html).not.toContain(NOTE);
        expect(html).not.toContain("Review sign-ups");
        expect(render(base, "dashboard")).toBe("");
    });

    test("an organiser: Review sign-ups, no note", () => {
        const html = render({ ...base, isOrganiser: true, allByEvent: [] });
        expect(html).toContain("Review sign-ups");
        expect(html).not.toContain(NOTE);
    });
});
