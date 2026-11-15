// Run: IS_BUILD=true bun test src/lib/events/event-currency.test.ts
// Event ticket currencies (Tim, 2026-11-15): ZAR (South African rand) added. The event form had its
// own list (EUR, USD, GBP, SEK), so a ZAR price couldn't be picked and a host whose booking currency
// is ZAR got no prefill. Booking settings and pledges already had ZAR (PEERIFY_CURRENCY_OPTIONS).

import { describe, expect, test } from "bun:test";
import { defaultEventCurrency, EVENT_CURRENCY_OPTIONS } from "./event-currency";
import { PEERIFY_CURRENCY_OPTIONS } from "@/lib/peerify/artist-profile";

describe("event currencies", () => {
    test("ZAR can be picked, next to the ones that were there", () => {
        expect(EVENT_CURRENCY_OPTIONS).toEqual(["EUR", "USD", "GBP", "SEK", "ZAR"]);
    });

    test("a host whose booking currency is ZAR gets ZAR on a new event", () => {
        expect(defaultEventCurrency("ZAR")).toBe("ZAR");
        expect(defaultEventCurrency("SEK")).toBe("SEK");
        expect(defaultEventCurrency("NOK")).toBeUndefined();
        expect(defaultEventCurrency("")).toBeUndefined();
        expect(defaultEventCurrency(undefined)).toBeUndefined();
    });

    test("every event currency is also in the shared list (booking settings, pledges)", () => {
        const shared = PEERIFY_CURRENCY_OPTIONS.map((option) => option.value as string);
        for (const code of EVENT_CURRENCY_OPTIONS) expect(shared).toContain(code);
    });
});
