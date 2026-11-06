// Run: IS_BUILD=true bun test src/components/modules/home/crew-module-gate.test.ts
// Crew switched off in Settings > Modules (2026-11-06): Join Crew, View Crew, the Crew Dashboard
// button and its badge used to check only the About page's Crew toggle (crewEnabled), so they
// still showed, and View Crew led to "not found". Every Crew entry point now uses isCrewOn, the
// same check the navigation and /api/access use (isModuleEnabled(circle, "crew")); a new
// application is refused server-side; the Dashboard and Crew Applications pages show managers a
// note instead. The database is in-memory fakes (testing/fake-db.ts); nothing real is touched.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const ARTIST_ID = "64a000000000000000000c01";
const ADMIN = "did:test:admin";
const FAN = "did:test:fan";
let circleUnderTest: any;
const notified: { type: string; recipients: string[] }[] = [];

mock.module("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
const realCookie = await import("@/lib/auth/cookie");
mock.module("@/lib/auth/cookie", () => ({ ...realCookie, readAuthToken: () => "token" }));
const realJwt = await import("@/lib/auth/jwt");
mock.module("@/lib/auth/jwt", () => ({ ...realJwt, verifyUserToken: async () => ({ userDid: FAN }) }));

const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => FAN,
    // The fan manages nothing; the admin manages everything on the artist circle.
    isAuthorized: async (did: string | undefined) => did === ADMIN,
    getAuthorizedMembers: async () => [{ did: ADMIN, handle: "admin" }],
}));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({ ...realCircle, getCircleById: async () => circleUnderTest }));
const realUser = await import("@/lib/data/user");
mock.module("@/lib/data/user", () => ({
    ...realUser,
    getUser: async (did: string) => ({ did, name: "Fan" }),
    getUserPrivate: async (did: string) => ({ did, name: did }),
}));
const realNotifications = await import("@/lib/data/notifications");
mock.module("@/lib/data/notifications", () => ({
    ...realNotifications,
    sendNotifications: async (type: string, recipients: { did: string }[]) => {
        notified.push({ type, recipients: recipients.map((r) => r.did) });
    },
}));

const { isCrewOn, showsCrewDashboardButton, CREW_OFF_APPLICATION_MESSAGE } = await import(
    "@/lib/peerify/crew-visibility"
);
const { isModuleEnabled } = await import("@/lib/auth/client-auth");
const { applyForCrewMembership } = await import("./actions");
const { default: CrewOffNote } = await import("@/components/modules/crew-applications/crew-off-note");

const MODULES_ON = ["home", "feed", "music", "crew"];
const MODULES_OFF = ["home", "feed", "music"];
const artist = (extra: Record<string, unknown> = {}) =>
    ({
        _id: ARTIST_ID,
        handle: "artist",
        name: "Artist",
        circleType: "circle",
        enabledModules: MODULES_ON,
        metadata: { peerify: { managedIdentity: true, identityType: "artist" } },
        ...extra,
    }) as any;

beforeEach(() => {
    fakeDb.reset();
    notified.length = 0;
});

describe("isCrewOn: the navigation's check", () => {
    test("Crew in Settings > Modules and the About toggle not off: on", () => {
        expect(isCrewOn(artist())).toBe(true);
        expect(isCrewOn(artist({ crewEnabled: true }))).toBe(true);
    });

    test("Crew switched off in Settings > Modules: off, even with the About toggle on", () => {
        expect(isCrewOn(artist({ enabledModules: MODULES_OFF }))).toBe(false);
        expect(isCrewOn(artist({ enabledModules: MODULES_OFF, crewEnabled: true }))).toBe(false);
    });

    test("the About toggle off: off, as before", () => {
        expect(isCrewOn(artist({ crewEnabled: false }))).toBe(false);
    });

    test("always the same answer as the navigation tab (isModuleEnabled)", () => {
        for (const circle of [
            artist(),
            artist({ enabledModules: MODULES_OFF }),
            artist({ crewEnabled: false }),
            artist({ enabledModules: [] }),
        ]) {
            expect(isCrewOn(circle)).toBe(isModuleEnabled(circle, "crew"));
        }
    });
});

describe("Crew Dashboard button and badge", () => {
    test("module on: shown to the artist's managers, as before", () => {
        expect(showsCrewDashboardButton(artist(), true)).toBe(true);
        expect(showsCrewDashboardButton(artist(), false)).toBe(false);
    });

    test("module off: hidden, so the badge isn't computed either", () => {
        expect(showsCrewDashboardButton(artist({ enabledModules: MODULES_OFF }), true)).toBe(false);
        expect(showsCrewDashboardButton(artist({ crewEnabled: false }), true)).toBe(false);
    });
});

describe("every Crew entry point uses the same check", () => {
    // Tests run from the app folder (circles/), one bun process per file.
    const src = (file: string) => readFileSync(path.join(process.cwd(), "src", file), "utf8");
    const entryPoints = {
        // Join Crew / View Crew / Application Pending and the Crew Dashboard button
        "components/modules/home/home-content.tsx": ["isCrewOn(circle) &&", "showsCrewDashboardButton(circle, authorizedToEdit)"],
        // the Discover card / map popup
        "components/layout/content-preview.tsx": ["isCrewOn(circle) &&"],
        // Join Crew inside the pledge dialog
        "components/modules/home/pledge-dialog.tsx": ["isCrewOn(circle)"],
        // the badge count
        "app/circles/[handle]/layout.tsx": ["showsCrewDashboardButton(circle, authorizedToEdit)"],
        "components/modules/home/home.tsx": ["showsCrewDashboardButton(circle, authorizedToEdit)"],
        // the pages
        "app/circles/[handle]/settings/crew/page.tsx": ["isCrewOn(circle)", "<CrewOffNote"],
        "app/circles/[handle]/settings/crew-applications/page.tsx": ["isCrewOn(circle)", "<CrewOffNote"],
    };

    for (const [file, needles] of Object.entries(entryPoints)) {
        test(`${file}`, () => {
            const text = src(file);
            for (const needle of needles) expect(text).toContain(needle);
            // The old toggle-only check is gone.
            expect(text).not.toContain("crewEnabled !== false");
        });
    }
});

describe("applying for Crew (server side)", () => {
    test("module off: refused with a clear message; nothing stored, nobody notified", async () => {
        circleUnderTest = artist({ enabledModules: MODULES_OFF });
        const result = await applyForCrewMembership(circleUnderTest, "I can drive the van");

        expect(result.success).toBe(false);
        expect(result.message).toBe(CREW_OFF_APPLICATION_MESSAGE);
        expect(fakeDb.col("CrewApplications").docs).toHaveLength(0);
        expect(notified).toEqual([]);
    });

    test("About toggle off: refused the same way", async () => {
        circleUnderTest = artist({ crewEnabled: false });
        const result = await applyForCrewMembership(circleUnderTest, "hi");
        expect(result.success).toBe(false);
        expect(result.message).toBe(CREW_OFF_APPLICATION_MESSAGE);
        expect(fakeDb.col("CrewApplications").docs).toHaveLength(0);
    });

    test("module on: the application is stored and the admin notified, as before", async () => {
        circleUnderTest = artist();
        const result = await applyForCrewMembership(circleUnderTest, "I can drive the van");

        expect(result.success).toBe(true);
        expect(fakeDb.col("CrewApplications").docs).toHaveLength(1);
        const [stored] = fakeDb.col("CrewApplications").docs;
        expect([stored.userDid, stored.circleId, stored.status]).toEqual([FAN, ARTIST_ID, "pending"]);
        expect(notified).toEqual([{ type: "crew_application", recipients: [ADMIN] }]);
    });
});

describe("Crew Dashboard / Crew Applications note while Crew is off", () => {
    const render = (props: { aboutToggleOff: boolean; pendingCount: number }) =>
        renderToStaticMarkup(React.createElement(CrewOffNote, { handle: "artist", ...props }));

    test("links to Settings > Modules and says how many pending applications are kept", () => {
        const html = render({ aboutToggleOff: false, pendingCount: 3 });
        expect(html).toContain("Crew is switched off");
        expect(html).toContain('href="/circles/artist/settings/pages"');
        expect(html).toContain("3 pending applications are kept");
        expect(html).not.toContain("/settings/about");
    });

    test("About toggle off too: also links to the toggle", () => {
        const html = render({ aboutToggleOff: true, pendingCount: 0 });
        expect(html).toContain('href="/circles/artist/settings/about"');
        expect(html).not.toContain("pending");
    });
});
