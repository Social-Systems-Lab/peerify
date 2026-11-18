// Shift capacity (Crew round 2, 2026-11-18): places are counted by CONFIRMED participants only.
// Pending sign-ups may exceed places; the organiser chooses who is confirmed, and confirmations never
// exceed `slots`. These MongoDB filter pieces let a write carry the condition itself, so two requests
// at the same moment can't go over.

// The number of participants with verifiedAt, as an aggregation expression.
const confirmedCountExpr = {
    $size: {
        $filter: {
            input: { $ifNull: ["$participants", []] },
            as: "p",
            cond: { $ifNull: ["$$p.verifiedAt", false] },
        },
    },
};

// Matches a shift whose confirmed participants are fewer than its places. A shift without `slots`
// never matches (null sorts before numbers).
export const confirmedBelowSlotsFilter = () => ({
    $expr: { $lt: [confirmedCountExpr, "$slots"] },
});

export const ALL_PLACES_CONFIRMED = "All places are confirmed";

// F5: total sign-ups (pending and confirmed) per shift stop at 3 × places, at least 10.
export const getShiftSignupCeiling = (slots: number) => Math.max(3 * slots, 10);

export const MANY_HAVE_OFFERED = "Many people have already offered for this shift";
