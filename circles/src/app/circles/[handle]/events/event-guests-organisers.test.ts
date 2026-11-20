// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/event-guests-organisers.test.ts"
// Event guests, D1 (2026-11-20): an event's guest list is for its creator, platform admins and
// whoever has "See and manage guests" (events.guests) on the event's circle: admins and moderators
// by default, with a verified profile. Before, it followed canManageEvent: a moderator saw only
// their own RSVP (Moderate Events is admins only), and an admin of a delegated artist circle saw
// every guest. The real isAuthorized runs against stored access rules saved before the new right
// existed (so it falls back to its default groups). Only the session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const HOST_ID = "64e100000000000000000001";
const ARTIST_ID = "64e100000000000000000002";
const OTHER_ID = "64e100000000000000000003";
const EVENT_ID = "64e1000000000000000000e1";

const CREATOR = "did:test:creator";
const ADMIN = "did:test:admin";
const MODERATOR = "did:test:moderator";
const UNVERIFIED_MODERATOR = "did:test:moderator-unverified";
const MEMBER = "did:test:member";
const ARTIST_ADMIN = "did:test:artist-admin";
const OTHER_ADMIN = "did:test:other-admin";
const PLATFORM_ADMIN = "did:test:platform-admin";
const GUEST_A = "did:test:guest-a";
const GUEST_B = "did:test:guest-b";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCircleByHandle: async (handle: string) => {
        const circle = fakeDb.col("Circles").docs.find((c) => c.handle === handle);
        return circle ? { ...circle, _id: circle._id.toString() } : null;
    },
}));

const { getAttendeesWithDetailsAction } = await import("./actions");

// What the Access rules form stored before "See and manage guests" existed: every other event feature.
const STORED_EVENT_RULES = {
    view: ["admins", "moderators", "members", "everyone"],
    update: ["admins", "moderators"],
    create: ["admins", "moderators"],
    review: ["admins", "moderators"],
    moderate: ["admins"],
    comment: ["admins", "moderators", "members", "everyone"],
    rsvp: ["admins", "moderators", "members", "everyone"],
};
const VERIFIED = { verificationStatus: "verified", isVerified: true };
const person = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":")[2],
    name: did.split(":")[2],
    circleType: "user",
    ...VERIFIED,
    ...extra,
});
const circle = (id: string, handle: string, createdBy: string) => ({
    _id: new ObjectId(id),
    did: `did:test:circle-${handle}`,
    handle,
    name: handle,
    circleType: "circle",
    createdBy,
    enabledModules: ["events"],
    accessRules: { events: STORED_EVENT_RULES },
});
const member = (userDid: string, circleId: string, userGroups: string[]) => ({
    _id: new ObjectId(),
    userDid,
    circleId,
    userGroups,
    joinedAt: new Date(),
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            circle(HOST_ID, "host", ADMIN),
            circle(ARTIST_ID, "artist", ARTIST_ADMIN),
            circle(OTHER_ID, "other", OTHER_ADMIN),
            person(CREATOR),
            person(ADMIN),
            person(MODERATOR),
            { ...person(UNVERIFIED_MODERATOR), verificationStatus: undefined, isVerified: false },
            person(MEMBER),
            person(ARTIST_ADMIN),
            person(OTHER_ADMIN),
            person(PLATFORM_ADMIN, { isAdmin: true }),
            person(GUEST_A),
            person(GUEST_B),
        ],
        Members: [
            member(CREATOR, HOST_ID, ["members"]),
            member(ADMIN, HOST_ID, ["admins", "moderators", "members"]),
            member(MODERATOR, HOST_ID, ["moderators", "members"]),
            member(UNVERIFIED_MODERATOR, HOST_ID, ["moderators", "members"]),
            member(MEMBER, HOST_ID, ["members"]),
            member(ARTIST_ADMIN, ARTIST_ID, ["admins", "members"]),
            member(OTHER_ADMIN, OTHER_ID, ["admins", "members"]),
        ],
        EventRsvps: [
            { eventId: EVENT_ID, circleId: HOST_ID, userDid: GUEST_A, status: "going", isPublic: true },
            { eventId: EVENT_ID, circleId: HOST_ID, userDid: GUEST_B, status: "going", isPublic: true },
        ],
    });
    fakeDb.setAggregateResult("Events", [
        {
            _id: EVENT_ID,
            circleId: HOST_ID,
            createdBy: CREATOR,
            title: "Home show",
            stage: "open",
            visibility: "public",
            userGroups: [],
            additionalArtistCircleIds: [ARTIST_ID],
            artistAdminCircleIds: [ARTIST_ID],
        },
    ]);
});

const seenBy = async (did: string) => {
    sessionDid = did;
    return (await getAttendeesWithDetailsAction("host", EVENT_ID)).attendees.map((a) => a.user.did).sort();
};

describe("who sees an event's guests (D1)", () => {
    test("the host circle's admin and a verified moderator see every guest", async () => {
        expect(await seenBy(ADMIN)).toEqual([GUEST_A, GUEST_B]);
        expect(await seenBy(MODERATOR)).toEqual([GUEST_A, GUEST_B]);
    });

    test("the event's creator and a platform admin see every guest", async () => {
        expect(await seenBy(CREATOR)).toEqual([GUEST_A, GUEST_B]);
        expect(await seenBy(PLATFORM_ADMIN)).toEqual([GUEST_A, GUEST_B]);
    });

    test("a moderator whose profile isn't verified sees nobody", async () => {
        expect(await seenBy(UNVERIFIED_MODERATOR)).toEqual([]);
    });

    test("an admin of a delegated artist circle sees nobody, although they may edit the event", async () => {
        expect(await seenBy(ARTIST_ADMIN)).toEqual([]);
    });

    test("a member, another circle's admin and a signed-out visitor see nobody", async () => {
        expect(await seenBy(MEMBER)).toEqual([]);
        expect(await seenBy(OTHER_ADMIN)).toEqual([]);
        sessionDid = undefined;
        expect((await getAttendeesWithDetailsAction("host", EVENT_ID)).attendees).toEqual([]);
    });

    test("a guest still sees only their own entry", async () => {
        expect(await seenBy(GUEST_A)).toEqual([GUEST_A]);
    });

    test("ticking only admins for See and manage guests takes the list from moderators", async () => {
        await fakeDb
            .col("Circles")
            .updateOne(
                { _id: new ObjectId(HOST_ID) },
                { $set: { "accessRules.events": { ...STORED_EVENT_RULES, guests: ["admins"] } } },
            );
        expect(await seenBy(MODERATOR)).toEqual([]);
        expect(await seenBy(ADMIN)).toEqual([GUEST_A, GUEST_B]);
    });
});
