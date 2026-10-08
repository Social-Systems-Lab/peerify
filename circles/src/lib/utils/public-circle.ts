import type { Circle, Location } from "@/models/models";
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
    // Group definitions (name/handle/title/description/accessLevel), not memberships — post,
    // discussion and event audience labels and the members table's role names read them.
    "userGroups",
    // The music page marks the featured track with it.
    "featuredTrackId",
] as const satisfies readonly (keyof Circle)[];

const PUBLIC_LOCATION_FIELDS = ["city", "region", "country", "countryCode", "precision"] as const;
const PUBLIC_PEERIFY_FIELDS = ["intent", "managedIdentity", "identityType"] as const;
const PUBLIC_ARTIST_PROFILE_FIELDS = [
    "baseCity",
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
// Logged-in viewers also get technicalNeeds (Tim, 2026-10-08).
const LOGGED_IN_BOOKING_SETTINGS_FIELDS = [...PUBLIC_BOOKING_SETTINGS_FIELDS, "technicalNeeds"] as const;
const PRIVATE_VENUE_PROFILE_FIELDS = new Set(["address", "publicCity"]);
// Contact details and the booking note are for logged-in viewers only (Tim, 2026-10-08). phone is
// treated like contactEmail.
const LOGGED_IN_VENUE_PROFILE_FIELDS = new Set(["contactEmail", "phone", "bookingNote"]);

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

// A location reduced to the fields public pages show (city/region/country) — street and lngLat are
// dropped whatever the owner's stored precision. Callers redact first (redactCircleLocationForViewer)
// and skip this for the owner / platform admins.
export const toPublicLocation = (location: Location | undefined): Location | undefined =>
    location ? (pickPresent(location as AnyRecord, PUBLIC_LOCATION_FIELDS) as Location) : location;

// Only metadata.peerify's listed public fields survive: onboardingFlow, signupIntent,
// autoProvisionedFromSignup, authProviders and anything else stored there never go out.
export const toPublicMetadata = (metadata: Circle["metadata"], viewerLoggedIn: boolean): Circle["metadata"] => {
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
            publicArtistProfile.bookingSettings = pickPresent(
                bookingSettings,
                viewerLoggedIn ? LOGGED_IN_BOOKING_SETTINGS_FIELDS : PUBLIC_BOOKING_SETTINGS_FIELDS,
            );
        }
        publicPeerify.artistProfile = publicArtistProfile;
    }

    const venueProfile = asRecord(peerify.venueProfile);
    if (venueProfile) {
        publicPeerify.venueProfile = Object.fromEntries(
            Object.entries(venueProfile).filter(
                ([key]) =>
                    !PRIVATE_VENUE_PROFILE_FIELDS.has(key) && (viewerLoggedIn || !LOGGED_IN_VENUE_PROFILE_FIELDS.has(key)),
            ),
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

    const publicMetadata = toPublicMetadata(circle.metadata, !!viewerDid);
    if (publicMetadata) {
        publicCircle.metadata = publicMetadata;
    }

    if (options.includeTourTeamOfferings && circle.tourTeamOfferings !== undefined) {
        publicCircle.tourTeamOfferings = circle.tourTeamOfferings;
    }

    return publicCircle;
}

// Extra top-level fields the list surfaces (Explore map and swipe cards, search, Discover, the
// circles directory) read on top of PUBLIC_CIRCLE_FIELDS. tourTeamOfferings is only present
// when the caller already decided this viewer may see it (searchDiscoverableCircles).
const PUBLIC_LIST_EXTRA_FIELDS = [
    "metrics",
    "cover",
    "isPublic",
    "mapVisible",
    "searchable",
    "isVerified",
    "verificationStatus",
    "isMember",
    "foundingMemberNumber",
    "createdAt",
    "primaryGenres",
    "primaryGenreOther",
    "representsOrganization",
    "organizationName",
    "offersVisible",
    "tourTeamOfferings",
] as const;
const PUBLIC_LIST_LOCATION_FIELDS = [...PUBLIC_LOCATION_FIELDS, "street", "lngLat"] as const;

// For circles in lists that reach anonymous visitors. Unlike toPublicCircle (profile pages, no
// pin), these keep a map pin, so the location is redacted here (city or coarser unless the owner
// confirmed "exact", venue addressVisibility ceiling) rather than dropped. Callers pass the
// stored location — or undefined to hide it — and must not redact it themselves first.
// Owners and platform admins get the circle back unchanged.
export function toPublicCircleListItem<T extends Circle>(circle: T, viewer: Omit<PublicCircleViewer, "viewerCanManage">): T {
    const { viewerDid, viewerIsPlatformAdmin } = viewer;
    if (viewerIsPlatformAdmin || (!!viewerDid && (circle.did === viewerDid || circle.createdBy === viewerDid))) {
        return circle;
    }
    const item = pickPresent(circle as AnyRecord, [...PUBLIC_CIRCLE_FIELDS, ...PUBLIC_LIST_EXTRA_FIELDS]) as T;
    const location = redactCircleLocationForViewer(circle, { viewerDid, viewerIsAdmin: viewerIsPlatformAdmin });
    if (location) {
        item.location = pickPresent(location as AnyRecord, PUBLIC_LIST_LOCATION_FIELDS) as Location;
    }
    const metadata = toPublicMetadata(circle.metadata, !!viewerDid);
    if (metadata) {
        item.metadata = metadata;
    }
    return item;
}
