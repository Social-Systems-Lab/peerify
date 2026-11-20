// Event capacity and confirmed guests (event guests, part 2, 2026-11-20). An organiser marks some
// of the people who clicked Attend as Confirmed (e.g. they paid). Confirmations are stored on the
// event as `guestConfirmations` and never exceed `capacity`: the write itself carries the condition,
// so two confirms at the same moment can't go over (as the shift confirm cap, shift-capacity.ts).
// An event without a capacity has no limit. Nothing here reads the database.

export const EVENT_CAPACITY_MAX = 100_000;
export const EVENT_CAPACITY_INVALID = "Capacity must be a whole number of at least 1, or left empty.";
export const ALL_TICKETS_CONFIRMED = "All places are confirmed";

// The form's capacity field: empty means no limit.
export const parseEventCapacity = (
    raw: unknown,
): { ok: true; capacity: number | undefined } | { ok: false; message: string } => {
    if (raw === undefined || raw === null) return { ok: true, capacity: undefined };
    const text = String(raw).trim();
    if (text === "") return { ok: true, capacity: undefined };
    const value = Number(text);
    if (!Number.isInteger(value) || value < 1 || value > EVENT_CAPACITY_MAX) {
        return { ok: false, message: EVENT_CAPACITY_INVALID };
    }
    return { ok: true, capacity: value };
};

export const capacityBelowConfirmedMessage = (confirmed: number) =>
    `${confirmed} ${confirmed === 1 ? "guest is" : "guests are"} confirmed, so the capacity can't be lower than ${confirmed}.`;

// The number of confirmed guests, as an aggregation expression on an event document.
export const confirmedGuestCountExpr = { $size: { $ifNull: ["$guestConfirmations", []] } };

// Matches an event that has room for one more confirmation: no capacity, or fewer confirmed than it.
export const roomForAnotherConfirmationFilter = () => ({
    $or: [{ capacity: null }, { $expr: { $lt: [confirmedGuestCountExpr, "$capacity"] } }],
});

// Matches an event whose confirmed guests fit within `capacity`.
export const confirmedFitWithinFilter = (capacity: number) => ({
    $expr: { $lte: [confirmedGuestCountExpr, capacity] },
});

export const countConfirmedGuests = (event: { guestConfirmations?: unknown[] | null }) =>
    Array.isArray(event.guestConfirmations) ? event.guestConfirmations.length : 0;

// "3 tickets left" / "Sold out" for a ticketed event, "3 places left" / "Full" otherwise (D5).
// null when the event has no capacity.
export const formatEventPlacesLeft = (event: {
    capacity?: number | null;
    confirmedGuests?: number;
    metadata?: { peerify?: { ticketed?: boolean } } | Record<string, any>;
}): { text: string; full: boolean } | null => {
    if (typeof event.capacity !== "number" || event.capacity < 1) return null;
    const ticketed = (event.metadata as any)?.peerify?.ticketed === true;
    const left = Math.max(0, event.capacity - (event.confirmedGuests ?? 0));
    if (left === 0) return { text: ticketed ? "Sold out" : "Full", full: true };
    const noun = ticketed ? (left === 1 ? "ticket" : "tickets") : left === 1 ? "place" : "places";
    return { text: `${left} ${noun} left`, full: false };
};
