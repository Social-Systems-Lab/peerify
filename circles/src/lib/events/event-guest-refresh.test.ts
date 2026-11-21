// Run: IS_BUILD=true bun test src/lib/events/event-guest-refresh.test.ts
// Event guests (2026-11-21): clicking the "You're confirmed" notice while the event page is open
// tells that page to reload its RSVP details; a rise in unread notices makes a waiting guest's page
// check again. The window event and the two decisions, without a browser.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
    EVENT_GUEST_UPDATED,
    announceIfEventGuestNotice,
    isEventGuestUpdateFor,
    shouldRecheckGuestDetails,
} from "./event-guest-refresh";

const EVENT_ID = "64e6000000000000000000e1";
const sent: Event[] = [];
const realWindow = (globalThis as any).window;

beforeEach(() => {
    sent.length = 0;
    const target = new EventTarget();
    target.addEventListener(EVENT_GUEST_UPDATED, (event) => sent.push(event));
    (globalThis as any).window = target;
});
afterAll(() => {
    (globalThis as any).window = realWindow;
});

describe("clicking a notice", () => {
    test("the confirmed notice tells that event's page to reload", () => {
        expect(announceIfEventGuestNotice({ notificationType: "event_guest_confirmed", eventId: EVENT_ID })).toBe(true);
        expect(sent).toHaveLength(1);
        expect(isEventGuestUpdateFor(sent[0], EVENT_ID)).toBe(true);
        expect(isEventGuestUpdateFor(sent[0], "64e6000000000000000000e2")).toBe(false);
    });

    test("a recurring occurrence's page counts as its event", () => {
        announceIfEventGuestNotice({ notificationType: "event_guest_confirmed", eventId: EVENT_ID });
        expect(isEventGuestUpdateFor(sent[0], `${EVENT_ID}_2026-12-06`)).toBe(true);
    });

    test("other notices, or one without an event, announce nothing", () => {
        expect(announceIfEventGuestNotice({ notificationType: "event_invitation", eventId: EVENT_ID })).toBe(false);
        expect(announceIfEventGuestNotice({ notificationType: "event_guest_confirmed" })).toBe(false);
        expect(sent).toEqual([]);
    });
});

describe("a new notice arriving", () => {
    test("a waiting guest's page checks again when the unread count rises", () => {
        expect(shouldRecheckGuestDetails(0, 1, "going", false)).toBe(true);
    });

    test("not on the first count, when it falls or stays, for a confirmed guest, or for anyone else", () => {
        expect(shouldRecheckGuestDetails(undefined, 3, "going", false)).toBe(false);
        expect(shouldRecheckGuestDetails(2, 1, "going", false)).toBe(false);
        expect(shouldRecheckGuestDetails(2, 2, "going", false)).toBe(false);
        expect(shouldRecheckGuestDetails(0, 1, "going", true)).toBe(false);
        expect(shouldRecheckGuestDetails(0, 1, "interested", false)).toBe(false);
        expect(shouldRecheckGuestDetails(0, 1, undefined, false)).toBe(false);
    });
});
