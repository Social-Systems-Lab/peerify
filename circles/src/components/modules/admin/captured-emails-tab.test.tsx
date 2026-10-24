// Run: bun test src/components/modules/admin/captured-emails-tab.test.tsx
// Renders the real AdminDashboard to static HTML. Its server actions and the heavy tab components are
// mocked (they aren't what's tested); the Tabs, Card and Button components are the real ones.

import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/modules/admin/actions", () => ({
    triggerReindexAction: async () => ({}),
    syncAllDonorboxSubscriptions: async () => ({}),
    sendReminderEmailForHandle: async () => ({}),
    triggerCronEmailReminder: async () => ({}),
}));
const Stub = () => null;
mock.module("@/components/modules/admin/global-server-settings-form", () => ({ GlobalServerSettingsForm: Stub }));
mock.module("@/components/modules/admin/tabs/circles-tab", () => ({ default: Stub }));
mock.module("@/components/modules/admin/tabs/users-tab", () => ({ default: Stub }));
mock.module("@/components/modules/admin/tabs/super-admins-tab", () => ({ default: Stub }));
mock.module("@/components/modules/admin/tabs/verification-requests-tab", () => ({ default: Stub }));
mock.module("@/components/modules/admin/tabs/system-messages-tab", () => ({ default: Stub }));

const { default: AdminDashboard } = await import("./admin-dashboard");

const render = (props: { showCapturedEmails?: boolean; initialTab?: string }) =>
    renderToStaticMarkup(
        React.createElement(AdminDashboard, {
            serverSettings: {} as never,
            circles: [],
            onboardingMcpStats: {
                totalUsersWithDonationIntent: 0,
                usersWithAmount: 0,
                totalMonthlyContributionPotential: 0,
                averageMonthlyContributionPotential: 0,
                volunteeringCount: 0,
                skippedCount: 0,
                amountBuckets: { "5": 0, "10": 0, "25": 0, "50": 0, "100+": 0, custom: 0 },
            },
            ...props,
        }),
    );

describe("Admin Dashboard: Captured emails tab", () => {
    test("capture mode off (prod): no tab at all, also when the URL asks for it", () => {
        for (const html of [render({}), render({ showCapturedEmails: false }), render({ initialTab: "captured-emails" })]) {
            expect(html).not.toContain("Captured emails");
            expect(html).not.toContain("/admin/emails");
            // The ordinary tabs are still there.
            expect(html).toContain("Server Settings");
        }
    });

    test("capture mode on: the tab is listed", () => {
        const html = render({ showCapturedEmails: true });
        expect(html).toContain("Captured emails");
    });

    test("capture mode on and the tab opened: it links to /admin/emails", () => {
        const html = render({ showCapturedEmails: true, initialTab: "captured-emails" });
        expect(html).toContain('href="/admin/emails"');
        expect(html).toContain("Open captured emails");
    });
});

describe("Admin Dashboard: Spaces tab", () => {
    test("always listed, also with capture mode off", () => {
        expect(render({})).toContain("Spaces");
    });

    test("opened: it links to /admin/spaces", () => {
        const html = render({ initialTab: "spaces" });
        expect(html).toContain('href="/admin/spaces"');
        expect(html).toContain("Open spaces");
    });
});
