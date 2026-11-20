// Run: IS_BUILD=true bun test src/lib/data/event-guest-dm-grant.test.ts
// Event guests, the Message button (2026-11-20): an event's organiser may start a DM with someone who
// clicked Attend or Interested, without a connection. findOrCreateDMConversationAction accepts the
// context { kind: "event_guest", circleId, eventId } only when mayMessageEventGuest holds: the event
// belongs to that circle, the sender sees its guests (canSeeEventGuests) and the recipient RSVPed
// to it. The DM then carries an event_guest grant, so either of them can write. In-memory fakes;
// session and permissions stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const HOST_ID = "64e200000000000000000001";
const OTHER_ID = "64e200000000000000000002";
const EVENT_ID = "64e2000000000000000000e1";
const OTHER_EVENT_ID = "64e2000000000000000000e2";

const CREATOR = "did:test:creator";
const ORGANISER = "did:test:organiser";
const MEMBER = "did:test:member";
const GUEST = "did:test:guest";
const FAN = "did:test:fan";
const STRANGER = "did:test:stranger";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    // ORGANISER has "See and manage guests" on HOST; nobody else has anything.
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) =>
        did === ORGANISER && String(circleId) === HOST_ID && feature === features.events.guests,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { mayMessageEventGuest } = await import("./event");
const { findOrCreateDMConversationAction } = await import("@/components/modules/chat/mongo-actions");

const VERIFIED = { verificationStatus: "verified", isVerified: true };
const person = (did: string) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":")[2],
    name: did.split(":")[2],
    circleType: "user",
    ...VERIFIED,
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(HOST_ID), did: "did:test:host", handle: "host", name: "Host", circleType: "circle" },
            {
                _id: new ObjectId(OTHER_ID),
                did: "did:test:other",
                handle: "other",
                name: "Other",
                circleType: "circle",
            },
            ...[CREATOR, ORGANISER, MEMBER, GUEST, FAN, STRANGER].map(person),
        ],
        Events: [
            { _id: new ObjectId(EVENT_ID), circleId: HOST_ID, createdBy: CREATOR, title: "Home show" },
            { _id: new ObjectId(OTHER_EVENT_ID), circleId: OTHER_ID, createdBy: STRANGER, title: "Elsewhere" },
        ],
        EventRsvps: [
            { eventId: EVENT_ID, circleId: HOST_ID, userDid: GUEST, status: "going" },
            { eventId: EVENT_ID, circleId: HOST_ID, userDid: FAN, status: "interested" },
            { eventId: `${EVENT_ID}_1767225600000`, circleId: HOST_ID, userDid: STRANGER, status: "going" },
            { eventId: OTHER_EVENT_ID, circleId: OTHER_ID, userDid: MEMBER, status: "going" },
        ],
        ChatConversations: [],
        ChatMessageDocs: [],
        UserRelationships: [],
        Members: [],
    });
});

describe("mayMessageEventGuest", () => {
    test("an organiser may message someone who clicked Attend or Interested", async () => {
        expect(await mayMessageEventGuest(ORGANISER, GUEST, HOST_ID, EVENT_ID)).toBe(true);
        expect(await mayMessageEventGuest(ORGANISER, FAN, HOST_ID, EVENT_ID)).toBe(true);
        expect(await mayMessageEventGuest(CREATOR, GUEST, HOST_ID, EVENT_ID)).toBe(true);
    });

    test("a recurring occurrence: the RSVP stored under the occurrence id counts", async () => {
        expect(await mayMessageEventGuest(ORGANISER, STRANGER, HOST_ID, `${EVENT_ID}_1767225600000`)).toBe(true);
        expect(await mayMessageEventGuest(ORGANISER, STRANGER, HOST_ID, EVENT_ID)).toBe(false);
    });

    test("not for someone who didn't RSVP to this event", async () => {
        expect(await mayMessageEventGuest(ORGANISER, MEMBER, HOST_ID, EVENT_ID)).toBe(false);
    });

    test("not for a sender who doesn't see the guests", async () => {
        expect(await mayMessageEventGuest(MEMBER, GUEST, HOST_ID, EVENT_ID)).toBe(false);
        expect(await mayMessageEventGuest(FAN, GUEST, HOST_ID, EVENT_ID)).toBe(false);
    });

    test("not when the circle doesn't match the event, or the event is another circle's", async () => {
        expect(await mayMessageEventGuest(ORGANISER, GUEST, OTHER_ID, EVENT_ID)).toBe(false);
        expect(await mayMessageEventGuest(ORGANISER, MEMBER, OTHER_ID, OTHER_EVENT_ID)).toBe(false);
        expect(await mayMessageEventGuest(ORGANISER, MEMBER, HOST_ID, OTHER_EVENT_ID)).toBe(false);
    });

    test("not for a missing or malformed event, a withdrawn reply, or oneself", async () => {
        expect(await mayMessageEventGuest(ORGANISER, GUEST, HOST_ID, "64e2000000000000000000ff")).toBe(false);
        expect(await mayMessageEventGuest(ORGANISER, GUEST, HOST_ID, "not-an-id")).toBe(false);
        await fakeDb.col("EventRsvps").updateOne({ userDid: GUEST }, { $set: { status: "cancelled" } });
        expect(await mayMessageEventGuest(ORGANISER, GUEST, HOST_ID, EVENT_ID)).toBe(false);
        expect(await mayMessageEventGuest(ORGANISER, ORGANISER, HOST_ID, EVENT_ID)).toBe(false);
    });
});

describe("the Message button's DM", () => {
    const context = { kind: "event_guest" as const, circleId: HOST_ID, eventId: EVENT_ID };

    test("an organiser who isn't connected to the guest gets the DM, with an event_guest grant", async () => {
        sessionDid = ORGANISER;
        const result = await findOrCreateDMConversationAction({ did: GUEST }, { grantContext: context });
        expect(result.success).toBe(true);
        const conversation = fakeDb.col("ChatConversations").docs[0];
        expect(conversation.participants).toEqual([ORGANISER, GUEST].sort());
        expect(conversation.dmGrants).toHaveLength(1);
        const { kind, circleId, eventId, grantedBy } = conversation.dmGrants[0];
        expect({ kind, circleId, eventId, grantedBy }).toEqual({
            kind: "event_guest",
            circleId: HOST_ID,
            eventId: EVENT_ID,
            grantedBy: ORGANISER,
        });
    });

    test("anyone else naming the same context is refused, and no conversation is made", async () => {
        sessionDid = MEMBER;
        const result = await findOrCreateDMConversationAction({ did: GUEST }, { grantContext: context });
        expect(result.success).toBe(false);
        expect(fakeDb.col("ChatConversations").docs).toEqual([]);
    });

    test("an organiser naming someone who didn't RSVP is refused", async () => {
        sessionDid = ORGANISER;
        const result = await findOrCreateDMConversationAction({ did: MEMBER }, { grantContext: context });
        expect(result.success).toBe(false);
        expect(fakeDb.col("ChatConversations").docs).toEqual([]);
    });
});
