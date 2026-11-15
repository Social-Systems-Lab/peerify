// Run: IS_BUILD=true bun test src/components/modules/events/event-where-text.test.ts
// Crew polish, item 4 (Tim, 2026-11-15): the event page showed the address two ways. The chip under
// the date used the location disclosure rule (street when "public"); the "Where" card always showed
// city, region and country only. Both now use the same rule.

import { describe, expect, test } from "bun:test";
import type { EventDisplay, PeerifyEventLocationDisclosure } from "@/models/models";
import { getPeerifyEventWhereText, getPeerifySafeEventLocationText } from "./peerify-event-disclosure-display";

const STREET = "Burg Street 1";
const fullLocation = {
    precision: 4,
    street: STREET,
    city: "Cape Town",
    region: "Western Cape",
    country: "South Africa",
};
const event = (fields: Partial<EventDisplay>): EventDisplay => ({ title: "Home show", ...fields }) as EventDisplay;
const disclosed = (locationDisclosure: PeerifyEventLocationDisclosure, extra: Record<string, unknown> = {}) =>
    event({
        location: fullLocation as EventDisplay["location"],
        metadata: { peerify: { locationDisclosure, ...extra } } as EventDisplay["metadata"],
    });

describe("the Where card and the chip show the same address", () => {
    test("public disclosure (the default): both show the street", () => {
        for (const e of [event({ location: fullLocation as EventDisplay["location"] }), disclosed("public")]) {
            expect(getPeerifyEventWhereText(e)).toBe(getPeerifySafeEventLocationText(e)!);
            expect(getPeerifyEventWhereText(e)).toContain(STREET);
        }
    });

    test("a hidden address, even in a manager's copy that still has the street: neither shows it", () => {
        for (const e of [
            disclosed("approximate"),
            disclosed("secret_after_acceptance"),
            disclosed("to_be_disclosed"),
            disclosed("secret_after_acceptance", { publicLocationLabel: "A private home in Cape Town" }),
        ]) {
            expect(getPeerifyEventWhereText(e)).toBe(getPeerifySafeEventLocationText(e)!);
            expect(getPeerifyEventWhereText(e)).not.toContain(STREET);
        }
    });

    test("the public label is used when there is one", () => {
        const e = disclosed("secret_after_acceptance", { publicLocationLabel: "A private home in Cape Town" });
        expect(getPeerifyEventWhereText(e)).toBe("A private home in Cape Town");
    });

    test("city only, and no location", () => {
        expect(
            getPeerifyEventWhereText(
                event({ location: { precision: 2, city: "Cape Town" } as EventDisplay["location"] }),
            ),
        ).toBe("Cape Town");
        expect(getPeerifyEventWhereText(event({}))).toBe("Not specified");
    });
});
