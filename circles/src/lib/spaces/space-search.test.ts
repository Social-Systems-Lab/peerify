// Run: IS_BUILD=true bun test src/lib/spaces/space-search.test.ts
// Explore search and space pins (2026-11-02): only a publicly shown pop-up name can match; private
// spaces, unnamed pop-ups and the pin's area names never do.

import { describe, expect, test } from "bun:test";
import { spacePinMatchesSearch } from "./space-search";

const location = { precision: 2, city: "Stockholm", region: "Stockholm", country: "Sweden" };

describe("spacePinMatchesSearch", () => {
    test("a pop-up with a shown name matches by that name", () => {
        const pin = { spaceKind: "popup" as const, name: "The Green Room", location };
        expect(spacePinMatchesSearch(pin, "green room")).toBe(true);
        expect(spacePinMatchesSearch(pin, "GREEN")).toBe(true);
        expect(spacePinMatchesSearch(pin, "jazz")).toBe(false);
    });

    test("a pop-up without a shown name never matches", () => {
        expect(spacePinMatchesSearch({ spaceKind: "popup" }, "green")).toBe(false);
    });

    test("a private space never matches, even if a name were somehow on the pin", () => {
        expect(spacePinMatchesSearch({ spaceKind: "private", name: "Anna's living room" }, "anna")).toBe(false);
    });

    test("area names are never matched", () => {
        const pin = { spaceKind: "popup" as const, name: "The Green Room", location };
        expect(spacePinMatchesSearch(pin, "Stockholm")).toBe(false);
        expect(spacePinMatchesSearch({ spaceKind: "private", location } as never, "Stockholm")).toBe(false);
    });

    test("an empty query matches nothing", () => {
        expect(spacePinMatchesSearch({ spaceKind: "popup", name: "The Green Room" }, "  ")).toBe(false);
    });
});
