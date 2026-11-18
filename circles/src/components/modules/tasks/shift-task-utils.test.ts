// Run: IS_BUILD=true bun test src/components/modules/tasks/shift-task-utils.test.ts
// Crew round 2, commit 3 (2026-11-18): the browser follows the server's rule. Places are counted by
// confirmed people only; pending sign-ups may exceed places up to the F5 ceiling (3 × places, at least
// 10). F3: crew see "2 places · 1 left", counting confirmed only, with no pending count.

import { describe, expect, test } from "bun:test";
import { formatShiftPlaces, getShiftOpenPlaces, getShiftSignupBlock, isShiftOversubscribed } from "./shift-task-utils";

const joinedAt = new Date("2026-11-10T10:00:00Z");
const pending = (n: number) => Array.from({ length: n }, (_, i) => ({ userDid: `did:test:p${i}`, joinedAt }));
const confirmed = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ userDid: `did:test:c${i}`, joinedAt, verifiedAt: joinedAt }));

describe("getShiftOpenPlaces: places minus confirmed", () => {
    test("pending sign-ups don't take places", () => {
        expect(getShiftOpenPlaces({ slots: 2, participants: pending(5) })).toBe(2);
        expect(getShiftOpenPlaces({ slots: 2, participants: [...confirmed(1), ...pending(3)] })).toBe(1);
    });
    test("never below 0, and 0 without places", () => {
        expect(getShiftOpenPlaces({ slots: 2, participants: confirmed(2) })).toBe(0);
        expect(getShiftOpenPlaces({ slots: 1, participants: confirmed(3) })).toBe(0);
        expect(getShiftOpenPlaces({ participants: [] })).toBe(0);
    });
});

describe("getShiftSignupBlock: why a new sign-up would be refused", () => {
    test("open while places aren't all confirmed, even with more pending than places", () => {
        expect(getShiftSignupBlock({ slots: 2, participants: pending(3) })).toBeNull();
    });
    test("all places confirmed", () => {
        expect(getShiftSignupBlock({ slots: 2, participants: [...confirmed(2), ...pending(1)] })).toBe("allConfirmed");
    });
    test("F5 ceiling: 2 places stop at 10 sign-ups, 5 places at 15", () => {
        expect(getShiftSignupBlock({ slots: 2, participants: pending(9) })).toBeNull();
        expect(getShiftSignupBlock({ slots: 2, participants: pending(10) })).toBe("manyOffered");
        expect(getShiftSignupBlock({ slots: 5, participants: [...confirmed(1), ...pending(13)] })).toBeNull();
        expect(getShiftSignupBlock({ slots: 5, participants: [...confirmed(1), ...pending(14)] })).toBe("manyOffered");
    });
    test("a non-manager's view: others' pending sign-ups come as pendingParticipantCount", () => {
        expect(getShiftSignupBlock({ slots: 2, participants: [], pendingParticipantCount: 10 })).toBe("manyOffered");
        expect(getShiftSignupBlock({ slots: 2, participants: confirmed(1), pendingParticipantCount: 4 })).toBeNull();
    });
    test("no places at all", () => {
        expect(getShiftSignupBlock({ slots: 0, participants: [] })).toBe("allConfirmed");
    });
});

describe("isShiftOversubscribed: more offers than places, places still open", () => {
    test("yes with 3 pending for 2 places", () => {
        expect(isShiftOversubscribed({ slots: 2, participants: pending(3) })).toBe(true);
        expect(isShiftOversubscribed({ slots: 2, participants: [], pendingParticipantCount: 2 })).toBe(true);
    });
    test("no while offers are fewer than places, and no once all places are confirmed", () => {
        expect(isShiftOversubscribed({ slots: 2, participants: pending(1) })).toBe(false);
        expect(isShiftOversubscribed({ slots: 2, participants: [...confirmed(2), ...pending(4)] })).toBe(false);
    });
});

describe("formatShiftPlaces (F3)", () => {
    test("places and places left, confirmed only", () => {
        expect(formatShiftPlaces(2, 1)).toBe("2 places · 1 left");
        expect(formatShiftPlaces(3, 0)).toBe("3 places · 3 left");
        expect(formatShiftPlaces(1, 0)).toBe("1 place · 1 left");
    });
    test("full", () => {
        expect(formatShiftPlaces(2, 2)).toBe("2 places · all confirmed");
    });
    test("no places set", () => {
        expect(formatShiftPlaces(0, 0)).toBe("Places to be confirmed");
    });
});
