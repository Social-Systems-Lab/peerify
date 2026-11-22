import { ObjectId } from "mongodb";
import { Circles, EventRsvps, Events } from "./db";
import { NO_PLACES_LEFT, roomForAnotherConfirmationFilter } from "@/lib/events/guest-capacity";
import { canPerformRestrictedAction, getRestrictedActionMessage } from "@/lib/auth/verification";
import { mayMessageEventGuest } from "./event";
import { addDmGrant, findOrCreateDmConversation } from "./mongo-chat";
import { getDmEligibility } from "./relationships";

// Confirmed guests (event guests, part 2, 2026-11-20). An organiser confirms someone who clicked
// Attend (e.g. they paid). Confirmations live on the event document (guestConfirmations), so the cap
// is one conditional write, like the shift confirm cap. Who may confirm is the caller's check
// (canSeeEventGuests); these functions only read and write.

export const CONFIRM_NEEDS_ATTEND = "Only someone who clicked Attend can be confirmed";
export const CONFIRM_NOT_ON_REPEATING = "Guests can't be confirmed on a repeating event yet";
// D4 (2026-11-20): a confirmed guest can't cancel or switch to Interested themselves. Their RSVP box
// has a "Message the organisers" button next to this (openConversationWithOrganisers).
export const CONFIRMED_GUEST_CANT_CHANGE = "You're confirmed for this event. To cancel, message the organisers.";
export const ONLY_CONFIRMED_GUESTS_MESSAGE = "Only confirmed guests can message the organisers from here";
export const NO_ORGANISER_TO_MESSAGE =
    "The organisers can't be messaged from here right now. Please leave a comment on the event.";

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
    return { ok: false, message: NO_PLACES_LEFT };
};

export const unconfirmEventGuest = async (eventId: string, guestDid: string): Promise<boolean> => {
    const _id = eventObjectId(eventId);
    if (!_id) return false;
    const result = await Events.updateOne({ _id }, { $pull: { guestConfirmations: { userDid: guestDid } } } as any);
    return result.acknowledged !== false;
};

/**
 * The organiser a confirmed guest's "Message the organisers" button reaches (2026-11-21): the person
 * who confirmed them or, if they can no longer see the event's guests or their account is gone, the
 * event's creator. Each must still pass the guest list's own rule (mayMessageEventGuest). null if
 * neither does, or if the guest isn't confirmed.
 */
export const findOrganiserForConfirmedGuest = async (eventId: string, guestDid: string): Promise<string | null> => {
    const _id = eventObjectId(eventId);
    if (!_id || !guestDid) return null;
    const event = await Events.findOne({ _id }, { projection: { circleId: 1, createdBy: 1, guestConfirmations: 1 } });
    const confirmation = (event?.guestConfirmations ?? []).find((entry) => entry.userDid === guestDid);
    if (!event || !confirmation) return null;
    const candidates = Array.from(new Set([confirmation.confirmedBy, event.createdBy])).filter(
        (did): did is string => !!did && did !== guestDid,
    );
    for (const did of candidates) {
        if (!(await Circles.findOne({ did, circleType: "user" }, { projection: { _id: 1 } }))) continue;
        if (await mayMessageEventGuest(did, guestDid, String(event.circleId), String(eventId))) return did;
    }
    return null;
};

/**
 * A confirmed guest pressed "Message the organisers": find or create their DM with the organiser from
 * findOrganiserForConfirmedGuest. Nothing is created before they press it (Tim, 2026-11-21). The same
 * rules as any new DM: the guest needs a verified profile, and if they aren't already allowed to write
 * to that person (connected, or an earlier grant), the DM gets an event_guest grant for this event, the
 * grant the guest list's Message button records.
 */
export const openConversationWithOrganisers = async (
    guestDid: string,
    circleId: string,
    eventId: string,
): Promise<{ ok: true; conversationId: string; organiserDid: string } | { ok: false; message: string }> => {
    if (!(await isConfirmedGuest(eventId, guestDid))) return { ok: false, message: ONLY_CONFIRMED_GUESTS_MESSAGE };
    const guest = await Circles.findOne({ did: guestDid, circleType: "user" });
    if (!guest?.did) return { ok: false, message: ONLY_CONFIRMED_GUESTS_MESSAGE };
    if (!canPerformRestrictedAction(guest as any)) {
        return { ok: false, message: getRestrictedActionMessage("message the organisers") };
    }
    const organiserDid = await findOrganiserForConfirmedGuest(eventId, guestDid);
    const organiser = organiserDid ? await Circles.findOne({ did: organiserDid, circleType: "user" }) : null;
    if (!organiserDid || !organiser?.did) return { ok: false, message: NO_ORGANISER_TO_MESSAGE };

    const alreadyAllowed = (await getDmEligibility(guestDid, organiserDid)).isAllowed;
    const conversation = await findOrCreateDmConversation(guest as any, organiser as any);
    if (!conversation?._id) return { ok: false, message: "Could not open the conversation" };
    const conversationId = String(conversation._id);
    if (!alreadyAllowed) {
        await addDmGrant(conversationId, {
            kind: "event_guest",
            circleId: String(circleId),
            eventId: String(eventId),
            grantedBy: guestDid,
            createdAt: new Date(),
        });
    }
    return { ok: true, conversationId, organiserDid };
};
