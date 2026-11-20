import { ObjectId } from "mongodb";
import { Circles, EventRsvps, Events } from "./db";
import { ALL_TICKETS_CONFIRMED, roomForAnotherConfirmationFilter } from "@/lib/events/guest-capacity";
import { canPerformRestrictedAction } from "@/lib/auth/verification";
import { mayMessageEventGuest } from "./event";
import { addDmGrant, findOrCreateDmConversation } from "./mongo-chat";

// Confirmed guests (event guests, part 2, 2026-11-20). An organiser confirms someone who clicked
// Attend (e.g. they paid). Confirmations live on the event document (guestConfirmations), so the cap
// is one conditional write, like the shift confirm cap. Who may confirm is the caller's check
// (canSeeEventGuests); these functions only read and write.

export const CONFIRM_NEEDS_ATTEND = "Only someone who clicked Attend can be confirmed";
export const CONFIRM_NOT_ON_REPEATING = "Guests can't be confirmed on a repeating event yet";
// D4 (2026-11-20): a confirmed guest can't cancel or switch to Interested themselves. Confirming opens
// a DM with the organiser who confirmed (openEventGuestConversation), so they can always write.
export const CONFIRMED_GUEST_CANT_CHANGE =
    "You're confirmed for this event. To cancel, please message the organisers (see your Messages).";

type ConfirmResult = { ok: true; alreadyConfirmed?: boolean } | { ok: false; message: string };

const eventObjectId = (eventId: string): ObjectId | null =>
    ObjectId.isValid(String(eventId)) && !String(eventId).includes("_") ? new ObjectId(String(eventId)) : null;

// The DIDs of an event's confirmed guests. Empty for a recurring occurrence's id.
export const getConfirmedGuestDids = async (eventId: string): Promise<Set<string>> => {
    const _id = eventObjectId(eventId);
    if (!_id) return new Set();
    const event = await Events.findOne({ _id }, { projection: { guestConfirmations: 1 } });
    return new Set((event?.guestConfirmations ?? []).map((confirmation) => confirmation.userDid));
};

export const isConfirmedGuest = async (eventId: string, userDid?: string): Promise<boolean> =>
    !!userDid && (await getConfirmedGuestDids(eventId)).has(userDid);

export const confirmEventGuest = async (
    eventId: string,
    guestDid: string,
    confirmedBy: string,
): Promise<ConfirmResult> => {
    const _id = eventObjectId(eventId);
    if (!_id) return { ok: false, message: CONFIRM_NOT_ON_REPEATING };
    const event = await Events.findOne({ _id }, { projection: { recurrence: 1, guestConfirmations: 1 } });
    if (!event) return { ok: false, message: "Event not found" };
    if (event.recurrence) return { ok: false, message: CONFIRM_NOT_ON_REPEATING };
    if ((event.guestConfirmations ?? []).some((confirmation) => confirmation.userDid === guestDid)) {
        return { ok: true, alreadyConfirmed: true };
    }
    if (!(await EventRsvps.findOne({ eventId: String(eventId), userDid: guestDid, status: "going" }))) {
        return { ok: false, message: CONFIRM_NEEDS_ATTEND };
    }

    // Not already confirmed, and room for one more: both in the write itself.
    const result = await Events.updateOne(
        {
            _id,
            guestConfirmations: { $not: { $elemMatch: { userDid: guestDid } } },
            ...roomForAnotherConfirmationFilter(),
        } as any,
        { $push: { guestConfirmations: { userDid: guestDid, confirmedAt: new Date(), confirmedBy } } } as any,
    );
    if (result.matchedCount > 0) return { ok: true };
    if (await isConfirmedGuest(eventId, guestDid)) return { ok: true, alreadyConfirmed: true };
    return { ok: false, message: ALL_TICKETS_CONFIRMED };
};

export const unconfirmEventGuest = async (eventId: string, guestDid: string): Promise<boolean> => {
    const _id = eventObjectId(eventId);
    if (!_id) return false;
    const result = await Events.updateOne({ _id }, { $pull: { guestConfirmations: { userDid: guestDid } } } as any);
    return result.acknowledged !== false;
};

/**
 * Opens the DM between the organiser who confirmed a guest and that guest, with an event_guest grant,
 * so a confirmed guest can always message the organisers (Tim, 2026-11-20). No message is sent; the
 * conversation simply appears in both people's Messages. The same rules as the guest list's Message
 * button: mayMessageEventGuest (the event is the circle's, the organiser sees its guests, the guest
 * RSVPed) and an organiser with a verified profile (anyone starting a DM needs one). Returns the
 * conversation id, or null when the rules don't allow it.
 */
export const openEventGuestConversation = async (
    organiserDid: string,
    guestDid: string,
    circleId: string,
    eventId: string,
): Promise<string | null> => {
    if (!(await mayMessageEventGuest(organiserDid, guestDid, circleId, eventId))) return null;
    const [organiser, guest] = await Promise.all([
        Circles.findOne({ did: organiserDid, circleType: "user" }),
        Circles.findOne({ did: guestDid, circleType: "user" }),
    ]);
    if (!organiser?.did || !guest?.did || !canPerformRestrictedAction(organiser as any)) return null;

    const conversation = await findOrCreateDmConversation(organiser as any, guest as any);
    if (!conversation?._id) return null;
    const conversationId = String(conversation._id);
    await addDmGrant(conversationId, {
        kind: "event_guest",
        circleId: String(circleId),
        eventId: String(eventId),
        grantedBy: organiserDid,
        createdAt: new Date(),
    });
    return conversationId;
};
