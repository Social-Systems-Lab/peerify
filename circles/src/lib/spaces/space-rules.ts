// Pure rules for spaces (see the Spaces comment in models.ts), shared by the space form and the
// server. parseSpaceInput is the only way a client's input becomes something lib/data/space.ts
// stores: it validates against spaceInputSchema (which also drops ownerDid, _id and any other
// field a client adds), trims, leaves out empty optional fields, and rebuilds the location from an
// allow-list. For a private space that rebuild is toAreaOnlyLocation: the exact spot is never
// stored, only the rough area. The form runs the same rounding as soon as a location is picked, so
// the exact point normally never leaves the browser either.

import { Location, SpaceInput, spaceInputSchema } from "@/models/models";
import { coarsenLngLat } from "@/lib/utils";

// Spaces one person may have (Tim, 2026-10-24). Checked by createSpaceForOwner (lib/data/space.ts).
export const SPACES_PER_PERSON_MAX = 10;

// About 11 km north–south and about 6 km east–west in southern Sweden (Tim, 2026-10-24): twice
// the public pin grid (PUBLIC_COARSE_PIN_GRID_DEGREES), since a home is more sensitive than a
// profile's city.
export const PRIVATE_SPACE_GRID_DEGREES = 0.1;
// City, in LocationPicker's precision levels.
export const PRIVATE_SPACE_PRECISION = 2;

const hasFiniteLngLat = (location: Location | undefined): boolean =>
    !!location?.lngLat && Number.isFinite(location.lngLat.lng) && Number.isFinite(location.lngLat.lat);

const pickDefined = <T extends Record<string, unknown>>(value: T): T =>
    Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== "")) as T;

// Country, region and city as names, and the point snapped to the 0.1° grid. Street, exact
// confirmation and anything else are dropped. Undefined when there's no usable point.
export function toAreaOnlyLocation(location: Location | undefined): Location | undefined {
    if (!location || !hasFiniteLngLat(location)) {
        return undefined;
    }
    return pickDefined({
        precision: PRIVATE_SPACE_PRECISION,
        country: location.country,
        countryCode: location.countryCode,
        region: location.region,
        city: location.city,
        lngLat: coarsenLngLat(location.lngLat, PRIVATE_SPACE_GRID_DEGREES),
    });
}

// A pop-up space keeps the location as entered (it's a business), minus fields that aren't part
// of a location and the public "show exact" confirmation: nothing shows spaces publicly yet.
function toPopupLocation(location: Location | undefined): Location | undefined {
    if (!location || !hasFiniteLngLat(location)) {
        return undefined;
    }
    return pickDefined({
        precision: typeof location.precision === "number" ? location.precision : 4,
        country: location.country,
        countryCode: location.countryCode,
        region: location.region,
        city: location.city,
        street: location.street,
        lngLat: { lng: location.lngLat!.lng, lat: location.lngLat!.lat },
    });
}

export type ParseSpaceResult = { ok: true; value: SpaceInput } | { ok: false; error: string };

export function parseSpaceInput(raw: unknown): ParseSpaceResult {
    const parsed = spaceInputSchema.safeParse(raw);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { ok: false, error: issue ? `${issue.path.join(".") || "space"}: ${issue.message}` : "Invalid space" };
    }
    const input = parsed.data;

    const dealPreferences = Array.from(new Set(input.dealPreferences));
    if (dealPreferences.includes("none") && dealPreferences.length > 1) {
        return { ok: false, error: "dealPreferences: \"none\" can't be combined with other choices" };
    }

    if (input.type === "private") {
        const location = toAreaOnlyLocation(input.location);
        if (!location) {
            return { ok: false, error: "location: pick the area on the map" };
        }
        return {
            ok: true,
            value: pickDefined({
                ...input,
                dealPreferences,
                setting: Array.from(new Set(input.setting)),
                location,
            }),
        };
    }

    const location = toPopupLocation(input.location);
    if (!location) {
        return { ok: false, error: "location: pick the place on the map" };
    }
    return { ok: true, value: pickDefined({ ...input, dealPreferences, location }) };
}
