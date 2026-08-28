// Fixed-enum venue/event feature-icon tag categories, shared by Circle.defaultEventTags and
// Event.tags. Circle and Event zod schemas (src/models/models.ts) build their z.enum(...)
// fields from these option lists; normalizeEventTags below is the single validation/cleanup
// path used when snapshotting a Circle's defaultEventTags onto a newly created Event.

export const EVENT_TAG_AGE_OPTIONS = ["all_ages", "18_plus"] as const;
export const EVENT_TAG_ALCOHOL_OPTIONS = ["byo", "served", "not_permitted"] as const;
export const EVENT_TAG_VENUE_TYPE_OPTIONS = ["home", "studio", "local_business", "public_venue"] as const;
// "available" and "not_allowed" are mutually exclusive (enforced in the picker UI —
// event-tags-settings.tsx's handleFoodChange — and again below as a data-integrity backstop);
// "byo_snacks" toggles independently of both.
export const EVENT_TAG_FOOD_OPTIONS = ["available", "byo_snacks", "not_allowed"] as const;
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
// that isn't a recognized option (including `null` — MongoDB's Node driver persists an
// explicit `undefined` property as literal BSON null with this project's MongoClient options,
// so an event/circle document read back from the DB routinely has null-valued keys for
// whichever categories were never set; normalizeSingleSelect/normalizeMultiSelect already treat
// anything that isn't a recognized string/array as absent, null included). Used both for user
// input and for cloning a Circle's defaultEventTags onto a new Event (the returned object is
// always a fresh value, never a reference to any part of `value`).
export const normalizeEventTags = (value: unknown): EventTagsValue | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const source = value as Record<string, unknown>;

    const age = normalizeSingleSelect(source.age, EVENT_TAG_AGE_OPTIONS);
    const alcohol = normalizeSingleSelect(source.alcohol, EVENT_TAG_ALCOHOL_OPTIONS);
    const venueType = normalizeSingleSelect(source.venueType, EVENT_TAG_VENUE_TYPE_OPTIONS);
    // "available" and "not_allowed" are mutually exclusive; the picker UI already prevents
    // selecting both, but a submission that bypasses it (a stale client, a direct API call)
    // shouldn't be able to persist a contradictory state. "not_allowed" wins as the stronger,
    // safer-to-trust claim if both somehow arrive together.
    const rawFood = normalizeMultiSelect(source.food, EVENT_TAG_FOOD_OPTIONS);
    const food =
        rawFood && rawFood.includes("not_allowed") ? rawFood.filter((value) => value !== "available") : rawFood;
    const seating = normalizeMultiSelect(source.seating, EVENT_TAG_SEATING_OPTIONS);
    const setting = normalizeMultiSelect(source.setting, EVENT_TAG_SETTING_OPTIONS);
    const accessibility = normalizeSingleSelect(source.accessibility, EVENT_TAG_ACCESSIBILITY_OPTIONS);

    // Only include keys that actually have a value, rather than setting them to `undefined` —
    // an object with `{alcohol: undefined}` is exactly the shape that turns into
    // `{alcohol: null}` once MongoDB writes it, which then fails eventTagsSchema's strict
    // z.enum().optional() (accepts undefined, not null) the next time this event is saved.
    // Omitting the key entirely means an unset category is simply absent, in memory and once
    // persisted, closing the loop rather than reproducing the same bug on every future save.
    const normalized: EventTagsValue = {
        ...(age !== undefined && { age }),
        ...(alcohol !== undefined && { alcohol }),
        ...(venueType !== undefined && { venueType }),
        ...(food !== undefined && { food }),
        ...(seating !== undefined && { seating }),
        ...(setting !== undefined && { setting }),
        ...(accessibility !== undefined && { accessibility }),
    };

    return Object.keys(normalized).length > 0 ? normalized : undefined;
};
