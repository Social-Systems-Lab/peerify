// Run: IS_BUILD=true bun test "src/app/circles/[handle]/settings/settings-layout-leaks.test.ts"
// Leak round 3, M7 (2026-11-07): the settings layout handed the circle as loaded (SAFE projection:
// exact location and other private fields) to a client component, guarded only by the route guard,
// which lets everyone in when a circle has no settings rule. Now the layout checks the circle's
// "View settings" rule itself (default: admins) and gives anyone who isn't a manager (edit_about)
// the public copy. Admins still get the full circle. The database is in-memory fakes, the session
// is stubbed, and the permission checks are the real ones.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const VENUE_ID = "64f300000000000000000001";
const ADMIN = "did:test:admin";
const MODERATOR = "did:test:moderator";
const STRANGER = "did:test:stranger";
const STREET = "Canary Venue Backdoor 3";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));

class Redirect extends Error {
    constructor(public url: string) {
        super("NEXT_REDIRECT");
    }
}
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    redirect: (url: string) => {
        throw new Redirect(url);
    },
}));
mock.module("./settings-layout-wrapper", () => ({ SettingsLayoutWrapper: () => null }));

const { default: SettingsLayout } = await import("./layout");

const seed = (settingsRule?: string[]) =>
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(VENUE_ID),
                did: "did:test:venue",
                handle: "venue",
                name: "Venue",
                circleType: "circle",
                location: { precision: 4, city: "Stockholm", country: "Sweden", street: STREET, lngLat: { lng: 18.0712, lat: 59.33 } },
                ...(settingsRule ? { accessRules: { settings: { view: settingsRule } } } : {}),
            },
            { _id: new ObjectId(), did: ADMIN, handle: "admin", name: "Admin", circleType: "user", isVerified: true },
            { _id: new ObjectId(), did: MODERATOR, handle: "mod", name: "Mod", circleType: "user" },
            { _id: new ObjectId(), did: STRANGER, handle: "stranger", name: "Stranger", circleType: "user" },
        ],
        Members: [
            { userDid: ADMIN, circleId: VENUE_ID, userGroups: ["admins", "members"] },
            { userDid: MODERATOR, circleId: VENUE_ID, userGroups: ["moderators", "members"] },
        ],
    });

beforeEach(() => {
    sessionDid = undefined;
    seed();
});

const open = async (): Promise<{ redirectedTo?: string; circle?: any }> => {
    try {
        const element: any = await SettingsLayout({ params: Promise.resolve({ handle: "venue" }), children: null });
        return { circle: element.props.circle };
    } catch (error) {
        if (error instanceof Redirect) return { redirectedTo: error.url };
        throw error;
    }
};

describe("settings layout", () => {
    test("no settings rule stored: a signed-in stranger and a logged-out visitor are turned away", async () => {
        for (const viewer of [STRANGER, undefined]) {
            sessionDid = viewer;
            const result = await open();
            expect(result.redirectedTo).toContain("/circles/venue/access-denied");
            expect(JSON.stringify(result.circle ?? {})).not.toContain(STREET);
        }
    });

    test("moderators allowed by the rule get in, with the public copy only", async () => {
        seed(["admins", "moderators"]);
        sessionDid = MODERATOR;
        const result = await open();
        expect(result.redirectedTo).toBeUndefined();
        expect(result.circle?.handle).toBe("venue");
        expect(JSON.stringify(result.circle)).not.toContain(STREET);
    });

    test("an admin still gets the full circle", async () => {
        for (const rule of [undefined, ["admins"]]) {
            seed(rule);
            sessionDid = ADMIN;
            const result = await open();
            expect(result.redirectedTo).toBeUndefined();
            expect(result.circle?.location?.street).toBe(STREET);
        }
    });
});
