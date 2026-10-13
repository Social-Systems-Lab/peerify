import { locationSchema, type Location } from "@/models/models";

// An event (or the host profile it's prefilled from) can hold a location that says nothing:
// profiles saved while the map wasn't available store {} (see LocationPicker), and the event form
// used to copy that into new events, which createEventAction then rejected. Shared by the form and
// the event actions so both treat such a value as "no location".
export const EVENT_LOCATION_REQUIRED_MESSAGE = "Add a location for this event, or mark it as virtual.";

// A location only counts when it has the stored shape and says where: coordinates, or at least a
// street, city, region or country.
export function toUsableLocation(value: unknown): Location | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const parsed = locationSchema.safeParse(value);
    if (!parsed.success) {
        return undefined;
    }
    const location = parsed.data;
    return location.lngLat || location.street || location.city || location.region || location.country
        ? location
        : undefined;
}

// What a location form field sent, for saves that must tell "never touched" from "cleared":
// - "set": a usable location;
// - "cleared": LocationPicker's Clear button ({ precision } with nothing that says where) or null;
// - "untouched": the form's {} default for a profile with no location, or nothing at all.
export function classifyLocationInput(value: unknown): "set" | "cleared" | "untouched" {
    if (toUsableLocation(value)) {
        return "set";
    }
    if (value === null) {
        return "cleared";
    }
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
        return "cleared";
    }
    return "untouched";
}

// The form's "location" field is JSON; anything unparseable is "no location" too.
export function parseUsableLocationInput(raw: unknown): Location | undefined {
    if (typeof raw !== "string" || !raw.trim()) {
        return undefined;
    }
    try {
        return toUsableLocation(JSON.parse(raw));
    } catch {
        return undefined;
    }
}

// Virtual-only events don't need a place; physical and hybrid ones do.
export const eventNeedsLocation = (isVirtual: boolean | undefined, isHybrid: boolean | undefined): boolean =>
    !isVirtual || isHybrid === true;
