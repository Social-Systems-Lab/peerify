// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/event-guest-confirm.test.ts"
// Event guests, part 2 (2026-11-20): an event's organisers (canSeeEventGuests) mark people who clicked
// Attend as Confirmed. Confirmations are stored on the event and never exceed its capacity; the cap
// is in the write itself, so two confirms at the same moment can't go over. Nobody else can confirm,
// and only Attend (not Interested) can be confirmed. In-memory fakes; session and permissions stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const HOST_ID = "64e400000000000000000001";
const OTHER_ID = "64e400000000000000000002";
const EVENT_ID = "64e4000000000000000000e1";
const CREATOR = "did:test:creator";
const ORGANISER = "did:test:organiser";
const MEMBER = "did:test:member";
const ANN = "did:test:ann";
const BO = "did:test:bo";
const CY = "did:test:cy";
const FAN = "did:test:fan";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    // Everyone signed in may view HOST's events; ORGANISER has "See and manage guests" there.
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) => {
        if (!did || String(circleId) !== HOST_ID) return false;
        if (feature === features.events.view || feature === features.events.rsvp) return true;
        return feature === features.events.guests && did === ORGANISER;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const {
    confirmEventGuestAction,
    unconfirmEventGuestAction,
    getEventGuestsAction,
    rsvpEventAction,
    rsvpEventWithOptionsAction,
    cancelRsvpAction,
} = await import("./actions");

const person = (did: string) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":")[2],
    name: did.split(":")[2],
    circleType: "user",
});
const eventDoc = (extra: Record<string, unknown> = {}) => ({
    circleId: HOST_ID,
    createdBy: CREATOR,
    title: "Home show",
    stage: "open",
    visibility: "public",
    userGroups: [],
    ...extra,
});
const seed = (extra: Record<string, unknown> = {}) => {
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
            ...[CREATOR, ORGANISER, MEMBER, ANN, BO, CY, FAN].map(person),
        ],
        Events: [{ _id: new ObjectId(EVENT_ID), ...eventDoc(extra) }],
        EventRsvps: [
            { eventId: EVENT_ID, circleId: HOST_ID, userDid: ANN, status: "going", updatedAt: new Date(1) },
            { eventId: EVENT_ID, circleId: HOST_ID, userDid: BO, status: "going", updatedAt: new Date(2) },
            { eventId: EVENT_ID, circleId: HOST_ID, userDid: CY, status: "going", updatedAt: new Date(3) },
            { eventId: EVENT_ID, circleId: HOST_ID, userDid: FAN, status: "interested", updatedAt: new Date(4) },
        ],
        Members: [],
    });
    fakeDb.setAggregateResult("Events", [{ _id: EVENT_ID, ...eventDoc(extra) }]);
};
const confirmedDids = () =>
    ((fakeDb.col("Events").docs[0].guestConfirmations ?? []) as { userDid: string }[]).map((c) => c.userDid);
const confirm = (did: string) => confirmEventGuestAction("host", EVENT_ID, did);

beforeEach(() => {
    sessionDid = ORGANISER;
    seed({ capacity: 2 });
});

describe("confirming guests", () => {
    test("an organiser confirms someone who clicked Attend; who and when are stored", async () => {
        expect((await confirm(ANN)).success).toBe(true);
        const [stored] = fakeDb.col("Events").docs[0].guestConfirmations;
        expect(stored.userDid).toBe(ANN);
        expect(stored.confirmedBy).toBe(ORGANISER);
        expect(stored.confirmedAt instanceof Date).toBe(true);
    });

    test("the event's creator may confirm too", async () => {
        sessionDid = CREATOR;
        expect((await confirm(ANN)).success).toBe(true);
    });

    test("nobody else may confirm, the guest included", async () => {
        for (const did of [MEMBER, ANN, FAN, undefined]) {
            sessionDid = did;
            expect((await confirm(ANN)).success).toBe(false);
        }
        expect(confirmedDids()).toEqual([]);
    });

    test("only Attend can be confirmed: not Interested, not someone who didn't reply", async () => {
        expect(await confirm(FAN)).toEqual({
            success: false,
            message: "Only someone who clicked Attend can be confirmed",
        });
        expect((await confirm(MEMBER)).success).toBe(false);
        expect(confirmedDids()).toEqual([]);
    });

    test("never more than the capacity", async () => {
        expect((await confirm(ANN)).success).toBe(true);
        expect((await confirm(BO)).success).toBe(true);
        expect(await confirm(CY)).toEqual({ success: false, message: "All places are confirmed" });
        expect(confirmedDids()).toEqual([ANN, BO]);
    });

    test("two confirms at the same moment for the last place: only one gets it", async () => {
        seed({ capacity: 1 });
        const results = await Promise.all([confirm(ANN), confirm(BO)]);
        expect(results.filter((r) => r.success)).toHaveLength(1);
        expect(confirmedDids()).toHaveLength(1);
    });

    test("no capacity: no limit", async () => {
        seed();
        for (const did of [ANN, BO, CY]) expect((await confirm(did)).success).toBe(true);
        expect(confirmedDids()).toEqual([ANN, BO, CY]);
    });

    test("confirming twice stores one confirmation", async () => {
        await confirm(ANN);
        expect(await confirm(ANN)).toEqual({ success: true, message: "Already confirmed" });
        expect(confirmedDids()).toEqual([ANN]);
    });

    test("not through another circle's URL, nor on a repeating event", async () => {
        fakeDb.setAggregateResult("Events", [{ _id: EVENT_ID, ...eventDoc({ circleId: OTHER_ID }) }]);
        expect((await confirm(ANN)).success).toBe(false);
        seed({ recurrence: { frequency: "weekly", interval: 1 } });
        expect(await confirm(ANN)).toEqual({
            success: false,
            message: "Guests can't be confirmed on a repeating event yet",
        });
        expect(confirmedDids()).toEqual([]);
    });

    test("an organiser can undo a confirmation, which frees the place; nobody else can", async () => {
        await confirm(ANN);
        await confirm(BO);
        sessionDid = ANN;
        expect((await unconfirmEventGuestAction("host", EVENT_ID, ANN)).success).toBe(false);
        expect(confirmedDids()).toEqual([ANN, BO]);
        sessionDid = ORGANISER;
        expect((await unconfirmEventGuestAction("host", EVENT_ID, ANN)).success).toBe(true);
        expect(confirmedDids()).toEqual([BO]);
        expect((await confirm(CY)).success).toBe(true);
    });
});

describe("the guest list shows confirmations", () => {
    test("organisers see who is confirmed, the capacity and the confirmed count", async () => {
        await confirm(BO);
        const result = await getEventGuestsAction("host", EVENT_ID);
        expect(result.guests.map((g) => [g.user.did, g.confirmed])).toEqual([
            [ANN, false],
            [BO, true],
            [CY, false],
            [FAN, false],
        ]);
        expect(result.capacity).toBe(2);
        expect(result.confirmedCount).toBe(1);
    });

    test("a guest sees only their own entry and whether they're confirmed, not the counts", async () => {
        await confirm(BO);
        sessionDid = BO;
        const result = await getEventGuestsAction("host", EVENT_ID);
        expect(result.guests.map((g) => [g.user.did, g.confirmed])).toEqual([[BO, true]]);
        expect(result.capacity).toBeUndefined();
        expect(result.confirmedCount).toBeUndefined();
    });
});

describe("a confirmed guest's own reply (D4)", () => {
    const CANT = "You're confirmed for this event. To cancel, please contact the organisers.";
    const statusOf = async (did: string) => (await fakeDb.col("EventRsvps").findOne({ userDid: did }))?.status;

    test("can't cancel or switch to Interested; can still update their Attend message", async () => {
        await confirm(ANN);
        sessionDid = ANN;
        expect(await cancelRsvpAction("host", EVENT_ID)).toEqual({ success: false, message: CANT });
        expect(await rsvpEventAction("host", EVENT_ID, "interested")).toEqual({ success: false, message: CANT });
        expect(await statusOf(ANN)).toBe("going");
        expect((await rsvpEventWithOptionsAction("host", EVENT_ID, "going", { message: "Running late" })).success).toBe(
            true,
        );
        expect(confirmedDids()).toEqual([ANN]);
    });

    test("once an organiser undoes the confirmation, they can cancel", async () => {
        await confirm(ANN);
        await unconfirmEventGuestAction("host", EVENT_ID, ANN);
        sessionDid = ANN;
        expect((await cancelRsvpAction("host", EVENT_ID)).success).toBe(true);
        expect(await statusOf(ANN)).toBeUndefined();
    });

    test("a guest who isn't confirmed can cancel and switch as before", async () => {
        sessionDid = BO;
        expect((await rsvpEventAction("host", EVENT_ID, "interested")).success).toBe(true);
        expect((await cancelRsvpAction("host", EVENT_ID)).success).toBe(true);
    });
});

describe("the confirmation notice (D3)", () => {
    const notices = () => fakeDb.col("Notifications").docs.filter((n) => n.type === "event_guest_confirmed");

    test("the guest gets one bell notice that names the event and the circle, not the organiser", async () => {
        await confirm(ANN);
        await confirm(ANN);
        const rows = notices();
        expect(rows).toHaveLength(1);
        expect(rows[0].userId).toBe(ANN);
        const content = rows[0].content as Record<string, any>;
        expect(content.body).toBe("You're confirmed for Home show. Guest details are on the event page.");
        expect(content.eventId).toBe(EVENT_ID);
        expect(content.circle?.handle).toBe("host");
        expect(content.user).toBeUndefined();
        expect(JSON.stringify(rows[0])).not.toContain(ORGANISER);
    });

    test("no notice when the confirm is refused, or for undoing one", async () => {
        await confirm(FAN);
        await confirm(ANN);
        await unconfirmEventGuestAction("host", EVENT_ID, ANN);
        expect(notices().map((n) => n.userId)).toEqual([ANN]);
    });

    test("the bell shows the circle's picture for it", async () => {
        const { showsActorPicture } = await import("@/components/layout/notification-avatar");
        expect(showsActorPicture("event_guest_confirmed")).toBe(false);
    });
});
