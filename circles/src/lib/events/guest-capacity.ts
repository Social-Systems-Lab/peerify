// Event capacity and confirmed guests (event guests, part 2, 2026-11-20). An organiser marks some
// of the people who clicked Attend as Confirmed (e.g. they paid). Confirmations are stored on the
// event as `guestConfirmations` and never exceed `capacity`: the write itself carries the condition,
// so two confirms at the same moment can't go over (as the shift confirm cap, shift-capacity.ts).
// An event without a capacity has no limit. Nothing here reads the database.
//
// Places taken outside Peerify (2026-11-22): an organiser can record places sold or given away
// elsewhere (e.g. tickets sold at the door) as `metadata.peerify.placesTakenOutside`. They count
// against the capacity like confirmed guests. The number is for the people who can edit the event:
// sanitizePeerifyPublicEventMetadata is an allowlist and leaves it out for everyone else.

export const EVENT_CAPACITY_MAX = 100_000;
export const EVENT_CAPACITY_INVALID = "Capacity must be a whole number of at least 1, or left empty.";
// Refusal when confirmed guests plus places taken outside Peerify fill the capacity (2026-11-22;
// was "All places are confirmed", which read wrongly once outside places can fill an event).
export const NO_PLACES_LEFT = "No places left";
export const PLACES_TAKEN_OUTSIDE_INVALID = "Places taken outside Peerify must be a whole number of 0 or more.";

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

// The form's "Places taken outside Peerify" field: empty means none (0).
export const parsePlacesTakenOutside = (raw: unknown): { ok: true; value: number } | { ok: false; message: string } => {
    if (raw === undefined || raw === null) return { ok: true, value: 0 };
    const text = String(raw).trim();
    if (text === "") return { ok: true, value: 0 };
    const value = Number(text);
    if (!Number.isInteger(value) || value < 0 || value > EVENT_CAPACITY_MAX) {
        return { ok: false, message: PLACES_TAKEN_OUTSIDE_INVALID };
    }
    return { ok: true, value };
};

// The stored outside count of an event (0 when none).
export const getPlacesTakenOutside = (event: { metadata?: unknown } | null | undefined): number => {
    const value = (event?.metadata as { peerify?: { placesTakenOutside?: unknown } } | null | undefined)?.peerify
        ?.placesTakenOutside;
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
};

// The metadata with the outside count set (or removed when 0). Never changes `metadata` itself.
export const withPlacesTakenOutside = <M extends Record<string, any> | null | undefined>(
    metadata: M,
    placesTakenOutside: number,
): Record<string, any> | undefined => {
    const peerify = { ...((metadata?.peerify as Record<string, unknown> | undefined) ?? {}) };
    if (placesTakenOutside > 0) peerify.placesTakenOutside = placesTakenOutside;
    else delete peerify.placesTakenOutside;
    if (!metadata && Object.keys(peerify).length === 0) return undefined;
    return { ...(metadata ?? {}), peerify };
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const capacityBelowConfirmedMessage = (confirmed: number, placesTakenOutside = 0) => {
    const parts = [
        ...(confirmed > 0 || placesTakenOutside === 0
            ? [`${plural(confirmed, "guest is", "guests are")} confirmed`]
            : []),
        ...(placesTakenOutside > 0
            ? [`${plural(placesTakenOutside, "place is", "places are")} taken outside Peerify`]
            : []),
    ];
    return `${parts.join(" and ")}, so the capacity can't be lower than ${confirmed + placesTakenOutside}.`;
};

// The number of confirmed guests, as an aggregation expression on an event document.
export const confirmedGuestCountExpr = { $size: { $ifNull: ["$guestConfirmations", []] } };

// The places taken outside Peerify, as an aggregation expression (0 when none).
export const placesTakenOutsideExpr = { $ifNull: ["$metadata.peerify.placesTakenOutside", 0] };

// The places taken: confirmed guests plus places taken outside Peerify. This sum is what pages get
// (EventDisplay.placesTaken), never its two parts: the outside count is for organisers only.
export const placesTakenExpr = { $add: [confirmedGuestCountExpr, placesTakenOutsideExpr] };

// Matches an event that has room for one more confirmation: no capacity, or fewer places taken
// (confirmed + outside) than it.
export const roomForAnotherConfirmationFilter = () => ({
    $or: [{ capacity: null }, { $expr: { $lt: [placesTakenExpr, "$capacity"] } }],
});

// Matches an event whose confirmed guests, plus `placesTakenOutside` (the value being saved), fit
// within `capacity`.
export const confirmedFitWithinFilter = (capacity: number, placesTakenOutside = 0) => ({
    $expr: { $lte: [{ $add: [confirmedGuestCountExpr, placesTakenOutside] }, capacity] },
});

export const countConfirmedGuests = (event: { guestConfirmations?: unknown[] | null }) =>
    Array.isArray(event.guestConfirmations) ? event.guestConfirmations.length : 0;

// "3 tickets left" / "Sold out" for a ticketed event, "3 places left" / "Full" otherwise (D5).
// null when the event has no capacity. `placesTaken` is confirmed guests plus places taken outside.
export const formatEventPlacesLeft = (event: {
    capacity?: number | null;
    placesTaken?: number;
    metadata?: { peerify?: { ticketed?: boolean } } | Record<string, any>;
}): { text: string; full: boolean } | null => {
    if (typeof event.capacity !== "number" || event.capacity < 1) return null;
    const ticketed = (event.metadata as any)?.peerify?.ticketed === true;
    const left = Math.max(0, event.capacity - (event.placesTaken ?? 0));
    if (left === 0) return { text: ticketed ? "Sold out" : "Full", full: true };
    const noun = ticketed ? (left === 1 ? "ticket" : "tickets") : left === 1 ? "place" : "places";
    return { text: `${left} ${noun} left`, full: false };
};
