// Run: IS_BUILD=true bun test src/lib/data/user-memberships.test.ts
// Round 3 follow-up (2026-10-20): getUserPrivate's memberships reach the browser on every page load
// (checkAuth). A joined circle's stored location and full metadata go only to that circle's
// managers (owner/creator, a group allowed settings.edit_about, platform admins); for everyone else
// the circle is shaped by toPublicCircle: city-level location, public metadata and fields. In-memory
// fakes; the memberships aggregate result is set by the test. The leak tests fail on the code before
// this change, which sent every joined circle as stored.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

process.env.CIRCLES_JWT_SECRET = "test-only-secret-for-user-memberships-test-0123456789";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);
let cookieToken: string | undefined;
mock.module("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
const realCookie = await import("@/lib/auth/cookie");
mock.module("@/lib/auth/cookie", () => ({ ...realCookie, readAuthToken: () => cookieToken }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getUserPrivate } = await import("./user");
const { checkAuth } = await import("@/components/auth/actions");
const { generateUserToken } = await import("@/lib/auth/jwt");

const USER = "did:test:user";
const STREET = "Lokalgatan 7";
const VENUE_ADDRESS = "Bakgården 2";
const VENUE_EMAIL = "booking@venue.test";

const joinedCircle = (id: string, handle: string, extra: Record<string, unknown> = {}) => ({
    _id: id,
    did: `did:test:${handle}`,
    handle,
    name: handle,
    circleType: "circle",
    createdBy: "did:test:someone-else",
    location: { precision: 4, city: "Umeå", country: "Sweden", street: STREET, lngLat: { lng: 20.26, lat: 63.83 } },
    accessRules: { feed: { post: ["members"] } },
    enabledModules: ["home", "feed"],
    userGroups: [{ handle: "members", name: "Members" }],
    metadata: {
        peerify: {
            identityType: "venue",
            managedIdentity: true,
            onboardingFlow: "private-flow",
            venueProfile: { address: VENUE_ADDRESS, contactEmail: VENUE_EMAIL, capacity: 120 },
        },
    },
    ...extra,
});
const membership = (circle: ReturnType<typeof joinedCircle>, userGroups: string[]) => ({
    circleId: circle._id,
    userGroups,
    joinedAt: new Date("2026-10-01T00:00:00Z"),
    circle,
});
const leaks = (circle: unknown) => {
    const text = JSON.stringify(circle) ?? "";
    return {
        street: text.includes(STREET),
        coordinates: text.includes("20.26"),
        venueAddress: text.includes(VENUE_ADDRESS),
        privateMetadata: text.includes("private-flow"),
    };
};
const NO_LEAKS = { street: false, coordinates: false, venueAddress: false, privateMetadata: false };
const ALL_LEAKS = { street: true, coordinates: true, venueAddress: true, privateMetadata: true };

const seedUser = (extra: Record<string, unknown> = {}) =>
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(),
                did: USER,
                handle: "user",
                name: "User",
                circleType: "user",
                isVerified: true,
                verificationStatus: "verified",
                ...extra,
            },
        ],
    });

beforeEach(() => {
    cookieToken = undefined;
    seedUser();
});

describe("getUserPrivate memberships", () => {
    test("a circle the user only follows/joins: public fields, city-level location", async () => {
        fakeDb.setAggregateResult("Members", [membership(joinedCircle("c1", "venue"), ["members"])]);
        const user = await getUserPrivate(USER);
        const circle = user.memberships[0].circle;
        expect(leaks(circle)).toEqual(NO_LEAKS);
        // What the client uses from memberships stays.
        expect(circle.handle).toBe("venue");
        expect(circle.location?.city).toBe("Umeå");
        expect(circle.accessRules).toEqual({ feed: { post: ["members"] } });
        expect(circle.userGroups).toEqual([{ handle: "members", name: "Members" }]);
        expect(circle.metadata?.peerify?.managedIdentity).toBe(true);
        expect(user.memberships[0].userGroups).toEqual(["members"]);
    });

    test("a circle the user administers comes back in full", async () => {
        fakeDb.setAggregateResult("Members", [membership(joinedCircle("c1", "venue"), ["admins", "members"])]);
        const user = await getUserPrivate(USER);
        expect(leaks(user.memberships[0].circle)).toEqual(ALL_LEAKS);
    });

    test("a circle the user created comes back in full", async () => {
        fakeDb.setAggregateResult("Members", [
            membership(joinedCircle("c1", "venue", { createdBy: USER }), ["members"]),
        ]);
        expect(leaks((await getUserPrivate(USER)).memberships[0].circle)).toEqual(ALL_LEAKS);
    });

    test("a group the circle lets edit its About counts as managing it; an unverified admin doesn't", async () => {
        const custom = joinedCircle("c1", "venue", {
            accessRules: { settings: { edit_about: ["moderators"] } },
        });
        fakeDb.setAggregateResult("Members", [membership(custom, ["moderators"])]);
        expect(leaks((await getUserPrivate(USER)).memberships[0].circle)).toEqual(ALL_LEAKS);

        seedUser({ isVerified: false, verificationStatus: "unverified" });
        fakeDb.setAggregateResult("Members", [membership(joinedCircle("c2", "venue2"), ["admins"])]);
        expect(leaks((await getUserPrivate(USER)).memberships[0].circle)).toEqual(NO_LEAKS);
    });

    test("checkAuth (page load) sends no joined circle's address or private metadata", async () => {
        fakeDb.setAggregateResult("Members", [membership(joinedCircle("c1", "venue"), ["members"])]);
        cookieToken = await generateUserToken(USER);
        const result = await checkAuth();
        expect(result.authenticated).toBe(true);
        expect(leaks(result.user?.memberships)).toEqual(NO_LEAKS);
    });
});
