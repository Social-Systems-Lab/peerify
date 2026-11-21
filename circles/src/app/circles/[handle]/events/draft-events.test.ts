// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/draft-events.test.ts"
// L3 (draft artist profiles, 2026-11-21): a draft artist's events were readable by handle.
// Logged out, canAnonymousViewCircleEvents returned true for every managed identity before it
// looked at publishStatus. Signed in, the actions only checked events.view, whose default
// includes "everyone". getEventsAction, getEventAction, getEventArtistsAction and
// canViewerSeeCircleEvents now refuse an unpublished circle unless the viewer may open it
// (creator, admins, moderators), as the circle layout does. The event fetchers are stubbed to
// return a marker event, so these tests check only the gate; the database is in-memory fakes.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    // events.view as by default: everyone, signed in or not.
    isAuthorized: async () => true,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const MARKER = { _id: "64a0000000000000000000f1", title: "SECRET DRAFT SHOW", additionalArtistCircleIds: [] };
const realEvent = await import("@/lib/data/event");
mock.module("@/lib/data/event", () => ({
    ...realEvent,
    getPublicEventsByCircleId: async () => [MARKER],
    getPublicEventByIdForCircle: async () => MARKER,
    getEventsByCircleId: async () => [MARKER],
    getEventById: async () => ({ ...MARKER, circleId: DRAFT_ID }),
    shapeEventsForViewer: async (events: unknown) => events,
    shapeEventForViewer: async (event: unknown) => event,
}));

const { getEventsAction, getEventAction } = await import("./actions");
const { canAnonymousViewCircleEvents, canViewerSeeCircleEvents } = await import("@/lib/data/event");

const DRAFT_ID = "64a000000000000000000f01";
const OWNER = "did:test:owner";
const STRANGER = "did:test:stranger";
const MODERATOR = "did:test:moderator";

const artist = (publishStatus?: string) => ({
    _id: DRAFT_ID,
    did: "did:test:artist",
    handle: "draft-artist",
    name: "Draft Artist",
    circleType: "circle",
    createdBy: OWNER,
    enabledModules: ["home", "events"],
    metadata: { peerify: { managedIdentity: true, identityType: "artist" } },
    ...(publishStatus ? { publishStatus } : {}),
});
const seed = (publishStatus?: string) =>
    fakeDb.reset({
        Circles: [artist(publishStatus)],
        Members: [{ userDid: MODERATOR, circleId: DRAFT_ID, userGroups: ["moderators", "members"] }],
    });
const shows = (output: unknown) => JSON.stringify(output ?? null).includes(MARKER.title);

beforeEach(() => {
    sessionDid = undefined;
    seed("draft");
});

describe("a draft artist's events", () => {
    for (const [who, did] of [
        ["signed out", undefined],
        ["a signed-in stranger", STRANGER],
    ] as const) {
        test(`${who}: the list and a single event are empty`, async () => {
            sessionDid = did;
            expect(shows(await getEventsAction("draft-artist"))).toBe(false);
            expect(shows(await getEventAction("draft-artist", MARKER._id))).toBe(false);
        });
    }

    test("logged out: canAnonymousViewCircleEvents says no for a draft managed identity", async () => {
        expect(await canAnonymousViewCircleEvents(artist("draft") as any)).toBe(false);
        expect(await canAnonymousViewCircleEvents(artist("pending_verification") as any)).toBe(false);
    });

    test("canViewerSeeCircleEvents (ICS): no for a stranger", async () => {
        expect(await canViewerSeeCircleEvents(artist("draft") as any, STRANGER)).toBe(false);
    });

    for (const [who, did] of [
        ["the creator", OWNER],
        ["a moderator", MODERATOR],
    ] as const) {
        test(`${who} still sees them`, async () => {
            sessionDid = did;
            expect(shows(await getEventsAction("draft-artist"))).toBe(true);
            expect(await canViewerSeeCircleEvents(artist("draft") as any, did)).toBe(true);
        });
    }
});

describe("a published artist's events: unchanged", () => {
    for (const status of ["published", undefined]) {
        test(`publishStatus ${status ?? "missing"}: signed out and signed in see them`, async () => {
            seed(status);
            expect(shows(await getEventsAction("draft-artist"))).toBe(true);
            expect(await canAnonymousViewCircleEvents(artist(status) as any)).toBe(true);
            sessionDid = STRANGER;
            expect(shows(await getEventsAction("draft-artist"))).toBe(true);
            expect(shows(await getEventAction("draft-artist", MARKER._id))).toBe(true);
        });
    }
});
