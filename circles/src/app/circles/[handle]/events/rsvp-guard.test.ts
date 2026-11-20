// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/rsvp-guard.test.ts"
// Event guests, G1 (2026-11-20): Attend, Interested and Cancel RSVP load the event first. Before,
// they checked rights on the circle in the URL only, so an RSVP could go to another circle's event,
// a draft, a cancelled event or an invitation-only one, and an RSVP opened a private event (getEventById
// lets in anyone who has RSVPed). In-memory fakes; session and permissions stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const HOST_ID = "64d000000000000000000001";
const OTHER_ID = "64d000000000000000000002";
const EVENT_ID = "64d0000000000000000000e1";
const AUTHOR = "did:test:author";
const MEMBER = "did:test:member";
const INVITEE = "did:test:invitee";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    // Every signed-in user may view HOST's events and RSVP to them; nobody moderates.
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) =>
        !!did && String(circleId) === HOST_ID && (feature === features.events.view || feature === features.events.rsvp),
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { rsvpEventAction, rsvpEventWithOptionsAction, cancelRsvpAction } = await import("./actions");

const user = (did: string, handle: string) => ({ _id: new ObjectId(), did, handle, name: handle, circleType: "user" });
const event = (overrides: Record<string, unknown> = {}) => ({
    _id: EVENT_ID,
    circleId: HOST_ID,
    createdBy: AUTHOR,
    title: "Home show",
    stage: "open",
    visibility: "public",
    userGroups: [],
    ...overrides,
});
const setEvent = (overrides: Record<string, unknown> = {}) => fakeDb.setAggregateResult("Events", [event(overrides)]);
const rsvpOf = async (did: string) =>
    (await fakeDb.col("EventRsvps").findOne({ eventId: EVENT_ID, userDid: did }))?.status;

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
            user(AUTHOR, "author"),
            user(MEMBER, "member"),
            user(INVITEE, "invitee"),
        ],
        EventRsvps: [],
        EventInvitations: [],
        Members: [],
    });
    setEvent();
});

describe("RSVP guard (G1)", () => {
    test("an open public event of the circle takes Attend and Interested", async () => {
        sessionDid = MEMBER;
        expect((await rsvpEventAction("host", EVENT_ID, "interested")).success).toBe(true);
        expect(await rsvpOf(MEMBER)).toBe("interested");
        expect((await rsvpEventWithOptionsAction("host", EVENT_ID, "going", { message: "Hi" })).success).toBe(true);
        expect(await rsvpOf(MEMBER)).toBe("going");
    });

    test("another circle's event can't be RSVPed through this circle's URL", async () => {
        setEvent({ circleId: OTHER_ID });
        sessionDid = MEMBER;
        expect((await rsvpEventAction("host", EVENT_ID, "going")).success).toBe(false);
        expect((await rsvpEventWithOptionsAction("host", EVENT_ID, "going")).success).toBe(false);
        expect(await rsvpOf(MEMBER)).toBeUndefined();
    });

    test("a missing event can't be RSVPed", async () => {
        fakeDb.setAggregateResult("Events", []);
        sessionDid = MEMBER;
        expect((await rsvpEventAction("host", EVENT_ID, "going")).success).toBe(false);
        expect(await rsvpOf(MEMBER)).toBeUndefined();
    });

    for (const stage of ["draft", "review", "cancelled"]) {
        test(`a ${stage} event takes no RSVP, from a member or its author`, async () => {
            setEvent({ stage });
            for (const did of [MEMBER, AUTHOR]) {
                sessionDid = did;
                expect((await rsvpEventAction("host", EVENT_ID, "going")).success).toBe(false);
                expect((await rsvpEventWithOptionsAction("host", EVENT_ID, "interested")).success).toBe(false);
                expect(await rsvpOf(did)).toBeUndefined();
            }
        });
    }

    test("an event for another audience (crew only) takes no RSVP from a non-crew member", async () => {
        setEvent({ userGroups: ["crew"] });
        sessionDid = MEMBER;
        expect((await rsvpEventAction("host", EVENT_ID, "going")).success).toBe(false);
        expect(await rsvpOf(MEMBER)).toBeUndefined();
    });

    test("a private event: refused for someone not invited, even with an RSVP already stored", async () => {
        setEvent({ visibility: "private" });
        sessionDid = MEMBER;
        expect((await rsvpEventAction("host", EVENT_ID, "going")).success).toBe(false);
        expect(await rsvpOf(MEMBER)).toBeUndefined();

        await fakeDb
            .col("EventRsvps")
            .insertOne({ eventId: EVENT_ID, circleId: HOST_ID, userDid: MEMBER, status: "interested" } as any);
        expect((await rsvpEventAction("host", EVENT_ID, "going")).success).toBe(false);
        expect(await rsvpOf(MEMBER)).toBe("interested");
    });

    test("a private event: its invitee and its author may RSVP", async () => {
        setEvent({ visibility: "private", invitations: [INVITEE] });
        sessionDid = INVITEE;
        expect((await rsvpEventAction("host", EVENT_ID, "going")).success).toBe(true);
        sessionDid = AUTHOR;
        expect((await rsvpEventAction("host", EVENT_ID, "interested")).success).toBe(true);
    });

    test("invite only (D9): refused without an invitation, accepted with one, refused once declined", async () => {
        setEvent({ metadata: { peerify: { accessMode: "invite_only" } } });
        sessionDid = MEMBER;
        const refused = await rsvpEventAction("host", EVENT_ID, "going");
        expect(refused).toEqual({ success: false, message: "This event is by invitation only" });

        await fakeDb
            .col("EventInvitations")
            .insertOne({ eventId: EVENT_ID, userDid: MEMBER, status: "declined" } as any);
        expect((await rsvpEventAction("host", EVENT_ID, "going")).success).toBe(false);

        sessionDid = INVITEE;
        await fakeDb
            .col("EventInvitations")
            .insertOne({ eventId: EVENT_ID, userDid: INVITEE, status: "pending" } as any);
        expect((await rsvpEventAction("host", EVENT_ID, "going")).success).toBe(true);
    });

    test("ticket required and approval required take RSVPs from anyone who may see the event (D9)", async () => {
        sessionDid = MEMBER;
        for (const accessMode of ["ticket_required", "approval_required", "open_rsvp"]) {
            setEvent({ metadata: { peerify: { accessMode } } });
            expect((await rsvpEventAction("host", EVENT_ID, "going")).success).toBe(true);
        }
    });

    test("cancel: refused for another circle's event, allowed on the circle's own event even after it closed", async () => {
        await fakeDb
            .col("EventRsvps")
            .insertOne({ eventId: EVENT_ID, circleId: OTHER_ID, userDid: MEMBER, status: "going" } as any);
        setEvent({ circleId: OTHER_ID });
        sessionDid = MEMBER;
        expect((await cancelRsvpAction("host", EVENT_ID)).success).toBe(false);
        expect(await rsvpOf(MEMBER)).toBe("going");

        setEvent({ stage: "cancelled" });
        expect((await cancelRsvpAction("host", EVENT_ID)).success).toBe(true);
        expect(await rsvpOf(MEMBER)).toBeUndefined();
    });

    test("signed out: nothing is written", async () => {
        expect((await rsvpEventAction("host", EVENT_ID, "going")).success).toBe(false);
        expect(await fakeDb.col("EventRsvps").countDocuments({})).toBe(0);
    });
});
