// Fixed-enum venue/event feature-icon tag categories, shared by Circle.defaultEventTags and
// Event.tags. Circle and Event zod schemas (src/models/models.ts) build their z.enum(...)
// fields from these option lists; normalizeEventTags below is the single validation/cleanup
// path used when snapshotting a Circle's defaultEventTags onto a newly created Event.

export const EVENT_TAG_AGE_OPTIONS = ["all_ages", "18_plus"] as const;
export const EVENT_TAG_ALCOHOL_OPTIONS = ["byo", "served", "not_permitted"] as const;
export const EVENT_TAG_VENUE_TYPE_OPTIONS = ["home", "studio", "local_business", "public_venue"] as const;
export const EVENT_TAG_FOOD_OPTIONS = ["available", "byo_snacks"] as const;
export const EVENT_TAG_SEATING_OPTIONS = ["floor_cushions", "seated", "standing"] as const;
export const EVENT_TAG_SETTING_OPTIONS = ["indoor", "outdoor"] as const;
export const EVENT_TAG_ACCESSIBILITY_OPTIONS = ["accessible", "stairs_involved", "not_specified"] as const;

export type EventTagAge = (typeof EVENT_TAG_AGE_OPTIONS)[number];
export type EventTagAlcohol = (typeof EVENT_TAG_ALCOHOL_OPTIONS)[number];
export type EventTagVenueType = (typeof EVENT_TAG_VENUE_TYPE_OPTIONS)[number];
export type EventTagFood = (typeof EVENT_TAG_FOOD_OPTIONS)[number];
export type EventTagSeating = (typeof EVENT_TAG_SEATING_OPTIONS)[number];
export type EventTagSetting = (typeof EVENT_TAG_SETTING_OPTIONS)[number];
export type EventTagAccessibility = (typeof EVENT_TAG_ACCESSIBILITY_OPTIONS)[number];

export type EventTagsValue = {
    age?: EventTagAge;
    alcohol?: EventTagAlcohol;
    venueType?: EventTagVenueType;
    food?: EventTagFood[];
    seating?: EventTagSeating[];
    setting?: EventTagSetting[];
    accessibility?: EventTagAccessibility;
};

const normalizeSingleSelect = <T extends string>(value: unknown, options: readonly T[]): T | undefined => {
    const validOptions = options as readonly string[];
    return typeof value === "string" && validOptions.includes(value) ? (value as T) : undefined;
};

const normalizeMultiSelect = <T extends string>(value: unknown, options: readonly T[]): T[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const validOptions = options as readonly string[];
    const nextValues = value.filter((v): v is T => typeof v === "string" && validOptions.includes(v));
    const deduped = Array.from(new Set(nextValues));
    return deduped.length > 0 ? deduped : undefined;
};

// Validates/cleans an arbitrary value against the category option lists, dropping anything
// that isn't a recognized option. Used both for user input and for cloning a Circle's
// defaultEventTags onto a new Event (the returned object is always a fresh value, never a
// reference to any part of `value`).
export const normalizeEventTags = (value: unknown): EventTagsValue | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const source = value as Record<string, unknown>;

    const normalized: EventTagsValue = {
        age: normalizeSingleSelect(source.age, EVENT_TAG_AGE_OPTIONS),
        alcohol: normalizeSingleSelect(source.alcohol, EVENT_TAG_ALCOHOL_OPTIONS),
        venueType: normalizeSingleSelect(source.venueType, EVENT_TAG_VENUE_TYPE_OPTIONS),
        food: normalizeMultiSelect(source.food, EVENT_TAG_FOOD_OPTIONS),
        seating: normalizeMultiSelect(source.seating, EVENT_TAG_SEATING_OPTIONS),
        setting: normalizeMultiSelect(source.setting, EVENT_TAG_SETTING_OPTIONS),
        accessibility: normalizeSingleSelect(source.accessibility, EVENT_TAG_ACCESSIBILITY_OPTIONS),
    };

    const hasAnyValue = Object.values(normalized).some((v) => v !== undefined);
    return hasAnyValue ? normalized : undefined;
};
