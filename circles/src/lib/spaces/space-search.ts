import type { SpaceMapPin } from "@/models/models";

// Whether a space pin matches an Explore search (2026-11-02). Only a name that is already public
// on the pin can match: SpaceMapPin.name, which getSpaceMapPins sets only for a pop-up pinned at its
// exact address whose owner chose to show the name. Private spaces and unnamed pop-ups never
// match, and the pin's area names (city, region, country) are never looked at, so a search can't
// find a host's space by place. Pins that don't match aren't drawn while a search is showing.
// Named venues are circles and match through the circle search as normal.
export const spacePinMatchesSearch = (pin: Pick<SpaceMapPin, "spaceKind" | "name">, query: string): boolean => {
    if (pin.spaceKind !== "popup" || !pin.name) return false;
    const name = pin.name.trim().toLowerCase();
    const q = query.trim().toLowerCase().replace(/^@/, "");
    if (!name || !q) return false;
    if (name.includes(q)) return true;
    // Like the circle search: any word of two or more letters or digits.
    return q
        .split(/[^a-z0-9]+/i)
        .filter((token) => token.length > 1)
        .some((token) => name.includes(token));
};
