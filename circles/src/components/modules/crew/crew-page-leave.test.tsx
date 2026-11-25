// Run: IS_BUILD=true bun test src/components/modules/crew/crew-page-leave.test.tsx
// Leave Crew on the Crew page (backlog item 2, 2026-11-25): a visible button in the Crew card for
// Crew members only (it was only in a popover on your own avatar). The confirm dialog says you'll
// still follow the artist. crew.tsx must check showsLeaveCrewButton before showing the button.

import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { readFileSync } from "fs";
import { join } from "path";
import { renderToStaticMarkup } from "react-dom/server";

const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { default: LeaveCrewButton, leaveCrewDescription } = await import("./leave-crew-button");
const { showsLeaveCrewButton } = await import("@/lib/peerify/crew-visibility");

describe("who sees Leave Crew on the Crew page", () => {
    test("a Crew member: yes", () => {
        expect(showsLeaveCrewButton(["members", "crew"])).toBe(true);
        expect(showsLeaveCrewButton(["moderators", "members", "crew"])).toBe(true);
    });

    test("admins and moderators who aren't Crew, followers, nobody signed in: no", () => {
        expect(showsLeaveCrewButton(["admins"])).toBe(false);
        expect(showsLeaveCrewButton(["admins", "members"])).toBe(false);
        expect(showsLeaveCrewButton(["moderators", "members"])).toBe(false);
        expect(showsLeaveCrewButton(["members"])).toBe(false);
        expect(showsLeaveCrewButton(undefined)).toBe(false);
    });

    test("crew.tsx checks it before showing the button", () => {
        const source = readFileSync(join(process.cwd(), "src/components/modules/crew/crew.tsx"), "utf8");
        expect(source).toContain("showsLeaveCrewButton(viewerMember?.userGroups)");
        expect(source).toContain("<LeaveCrewButton");
    });
});

describe("the Leave Crew button", () => {
    test("renders a visible Leave Crew button, dialog closed", () => {
        const html = renderToStaticMarkup(<LeaveCrewButton circleId="c1" circleName="Night Owls" />);
        expect(html).toContain('data-testid="leave-crew-button"');
        expect(html).toContain("Leave Crew");
        expect(html).not.toContain("role=\"alertdialog\"");
    });

    test("the dialog says you'll still follow the artist", () => {
        const text = leaveCrewDescription("Night Owls");
        expect(text).toContain("You'll still follow Night Owls as normal");
        expect(text).toContain("apply to rejoin Crew");
    });

    test("the avatar popover uses the same dialog", () => {
        const source = readFileSync(join(process.cwd(), "src/components/modules/crew/crew-member-rail.tsx"), "utf8");
        expect(source).toContain("<LeaveCrewDialog");
        expect(source).not.toContain("leaveCrewAction");
    });
});
