import type { Circle } from "@/models/models";
import { redactCircleLocationForViewer } from "@/lib/utils";

// Shapes a circle document for viewers who don't manage it, before it's serialised to the
// circle layout's client components (HomeCover, HomeContent, CircleTabs) and the home page's
// AboutPage. Those components receive the whole document, so without this every field
// SAFE_CIRCLE_PROJECTION returns — exact street/lngLat, private booking notes, signup/auth
// metadata — reaches anonymous visitors in the page payload.
//
// Shaping happens here, AFTER the fetch, rather than by narrowing SAFE_CIRCLE_PROJECTION:
// settings/about/actions.ts and onboarding/pilot/actions.ts read `metadata` through that
// projection and write the whole object back, so narrowing it there would silently delete
// data on the next save.

export type PublicCircleViewer = {
    viewerDid?: string;
    viewerIsPlatformAdmin: boolean;
    // Circle owner/admin — the same isAuthorized(edit_about) check the layout's authorizedToEdit
    // already uses. Kept separate from viewerIsPlatformAdmin on purpose.
    viewerCanManage: boolean;
};

export type PublicCircleOptions = {
    // AboutPage renders offers publicly by design (see home/page.tsx's offersPanelVisibility);
    // the layout's components never read them, so only the home page opts in.
    includeTourTeamOfferings?: boolean;
};

// Every top-level field the layout components, AboutPage and their children read for a
// non-managing viewer. location/metadata/tourTeamOfferings are handled separately below.
const PUBLIC_CIRCLE_FIELDS = [
    "_id",
    "did",
    "name",
    "handle",
    "picture",
    "images",
    "description",
    "content",
    "mission",
    "circleType",
    "circleLevel",
    "parentCircleId",
    "publishStatus",
    "members",
    "enabledModules",
    "accessRules",
    "crewEnabled",
    "crewWelcomeMessage",
    "questionnaire",
    "isFoundingMember",
    "interests",
    "causes",
    "skills",
    "offers",
    "needs",
    "engagements",
    "socialLinks",
    "websiteUrl",
] as const satisfies readonly (keyof Circle)[];

const PUBLIC_LOCATION_FIELDS = ["city", "region", "country", "countryCode", "precision"] as const;
const PUBLIC_PEERIFY_FIELDS = ["intent", "managedIdentity", "identityType"] as const;
const PUBLIC_ARTIST_PROFILE_FIELDS = [
    "primaryGenres",
    "primaryGenreOther",
    "genres",
    "artistTypes",
    "artistTypeOtherLabels",
    "musicLinks",
    "bookingEnabled",
] as const;
const PUBLIC_BOOKING_SETTINGS_FIELDS = [
    "baseFee",
    "currency",
    "travelRadiusKm",
    "localBookingsOnly",
    "preferredEventTypes",
] as const;
const PRIVATE_VENUE_PROFILE_FIELDS = new Set(["address", "publicCity"]);

type AnyRecord = Record<string, unknown>;

const asRecord = (value: unknown): AnyRecord | undefined =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : undefined;

// Copies only the listed keys that are actually present, so absent fields stay absent.
const pickPresent = (source: AnyRecord, keys: readonly string[]): AnyRecord => {
    const result: AnyRecord = {};
    for (const key of keys) {
        if (source[key] !== undefined) {
            result[key] = source[key];
        }
    }
    return result;
};

const toPublicMetadata = (metadata: Circle["metadata"]): Circle["metadata"] => {
    const peerify = asRecord(metadata?.peerify);
    if (!peerify) {
        return undefined;
    }

    const publicPeerify = pickPresent(peerify, PUBLIC_PEERIFY_FIELDS);

    const artistProfile = asRecord(peerify.artistProfile);
    if (artistProfile) {
        const publicArtistProfile = pickPresent(artistProfile, PUBLIC_ARTIST_PROFILE_FIELDS);
        const bookingSettings = asRecord(artistProfile.bookingSettings);
        if (artistProfile.bookingEnabled === true && bookingSettings) {
            publicArtistProfile.bookingSettings = pickPresent(bookingSettings, PUBLIC_BOOKING_SETTINGS_FIELDS);
        }
        publicPeerify.artistProfile = publicArtistProfile;
    }

    const venueProfile = asRecord(peerify.venueProfile);
    if (venueProfile) {
        publicPeerify.venueProfile = Object.fromEntries(
            Object.entries(venueProfile).filter(([key]) => !PRIVATE_VENUE_PROFILE_FIELDS.has(key)),
        );
    }

    return { peerify: publicPeerify };
};

// Pure: never mutates `circle`. Managers, platform admins and the circle's own owner get it back
// unchanged (same reference); everyone else gets a new, allow-listed object.
export function toPublicCircle(
    circle: Circle,
    viewer: PublicCircleViewer,
    options: PublicCircleOptions = {},
): Circle {
    const { viewerDid, viewerIsPlatformAdmin, viewerCanManage } = viewer;
    if (
        viewerIsPlatformAdmin ||
        viewerCanManage ||
        (!!viewerDid && (circle.did === viewerDid || circle.createdBy === viewerDid))
    ) {
        return circle;
    }

    const publicCircle = pickPresent(circle as AnyRecord, PUBLIC_CIRCLE_FIELDS) as Circle;

    // Redact first, from the untouched circle — redaction reads metadata.peerify's identityType
    // and venueProfile.addressVisibility, which must still be present when it runs. Street and
    // lngLat are then dropped regardless of the owner's chosen precision: nothing on these public
    // pages reads them.
    const redactedLocation = redactCircleLocationForViewer(circle, {
        viewerDid,
        viewerIsAdmin: viewerIsPlatformAdmin,
    });
    if (redactedLocation) {
        publicCircle.location = pickPresent(redactedLocation, PUBLIC_LOCATION_FIELDS) as Circle["location"];
    }

    const publicMetadata = toPublicMetadata(circle.metadata);
    if (publicMetadata) {
        publicCircle.metadata = publicMetadata;
    }

    if (options.includeTourTeamOfferings && circle.tourTeamOfferings !== undefined) {
        publicCircle.tourTeamOfferings = circle.tourTeamOfferings;
    }

    return publicCircle;
}
