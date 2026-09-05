// circle.ts - circle creation and management

import {
    Circle,
    CirclePublishStatus,
    CircleType,
    Location,
    OfferMapPin,
    PlatformMetrics,
    Post,
    ServerSettings,
    SortingOptions,
    TourTeamOffering,
    WithMetric,
} from "@/models/models";
import { getServerSettings } from "./server-settings";
import { Circles, Members, MembershipRequests, Feeds, Posts, ChatRooms } from "./db";
import { ObjectId } from "mongodb";
import { getDefaultAccessRules, defaultUserGroups, getDefaultModules } from "./constants";
import { isPeerifyArtistIdentity } from "@/lib/peerify/artist-profile";
import { getMetrics } from "../utils/metrics";
import { filterLocations } from "../utils";
import { deleteVbdCircle, deleteVbdPost, upsertVbdCircles } from "./vdb";
import { createDefaultChatRooms, getChatRoomByHandle, updateChatRoom } from "./chat";
import { createDefaultFeed } from "./feed";
import path from "path";
import fs from "fs";
import { USERS_DIR } from "../auth/auth";
import { getDefaultHeroImage, hasCircleImages } from "@/lib/default-heroes";
import {
    getVerificationReadiness,
    hasCustomPicture,
    hasAboutText,
    hasLocationSet,
    type VerificationReadiness,
    type VerificationReadinessItem,
} from "@/lib/verification-readiness";
import { buildVerifiedUserSet } from "@/lib/auth/verification";
import { isCommunityGuidelinesCompleted } from "@/lib/community-guidelines";

export const SAFE_CIRCLE_PROJECTION = {
    _id: 1,
    did: 1,
    publicKey: 1,
    name: 1,
    type: 1,
    email: 1,
    handle: 1,
    picture: 1,
    images: 1,
    description: 1,
    content: 1,
    mission: 1,
    crewWelcomeMessage: 1,
    crewEnabled: 1,
    isPublic: 1,
    showAdminsPublicly: 1,
    mapVisible: 1,
    searchable: 1,
    // Missed when offersVisible was first added — without this, any page reading a circle via
    // this projection (e.g. the Presence settings page) sees offersVisible as always undefined
    // regardless of the real DB value, making a successful save look like it didn't persist.
    offersVisible: 1,
    isVerified: 1,
    verificationStatus: 1,
    // Needed so getVerificationReadiness (src/lib/verification-readiness.ts) can see a
    // personal profile's Community Guidelines acceptance wherever a circle document reaches it
    // via this projection (e.g. updateCircle's auto-verify check, AboutPage's Home-tab
    // "Complete profile" banner) — without these, guidelines would silently read as
    // permanently unaccepted for every circle fetched through this projection, regardless of
    // its real state. No more sensitive than isVerified/verificationStatus already exposed
    // here — just another compliance flag, not personal data.
    communityGuidelinesAcceptance: 1,
    communityGuidelinesAcceptedAt: 1,
    isMember: 1,
    manualMember: 1,
    accountStatus: 1,
    isFoundingMember: 1,
    foundingMemberNumber: 1,
    foundingMemberGrantedAt: 1,
    userGroups: 1,
    enabledModules: 1,
    accessRules: 1,
    members: 1,
    questionnaire: 1,
    parentCircleId: 1,
    circleLevel: 1,
    createdBy: 1,
    createdAt: 1,
    circleType: 1,
    publishStatus: 1,
    interests: 1,
    offers_needs: 1,
    location: 1,
    causes: 1,
    skills: 1,
    primaryGenres: 1,
    primaryGenreOther: 1,
    defaultEventTags: 1,
    offers: 1,
    engagements: 1,
    needs: 1,
    tourTeamOfferings: 1,
    completedOnboardingSteps: 1,
    metadata: 1, // Include metadata for shadow post IDs
    socialLinks: 1,
    websiteUrl: 1,
    representsOrganization: 1,
    organizationName: 1,
    officialEmail: 1,
    donationIntent: 1,
    bookmarkedCircles: 1,
    pinnedCircles: 1,
    hiddenCancelledEventIds: 1,
} as const;

const DISCOVERY_CIRCLE_PROJECTION = {
    _id: 1,
    did: 1,
    name: 1,
    handle: 1,
    picture: 1,
    images: 1,
    description: 1,
    mission: 1,
    crewWelcomeMessage: 1,
    crewEnabled: 1,
    isPublic: 1,
    mapVisible: 1,
    searchable: 1,
    isVerified: 1,
    verificationStatus: 1,
    isMember: 1,
    isFoundingMember: 1,
    foundingMemberNumber: 1,
    members: 1,
    createdAt: 1,
    circleType: 1,
    publishStatus: 1,
    interests: 1,
    location: 1,
    causes: 1,
    skills: 1,
    primaryGenres: 1,
    primaryGenreOther: 1,
    websiteUrl: 1,
    representsOrganization: 1,
    organizationName: 1,
    metadata: 1,
    // Crew Offers (tourTeamOfferings) are deliberately NOT projected here — this feeds the
    // /explore map/discovery surface, which has no crew-membership or ownership gating at all,
    // and Crew Offers were never meant to be visible outside a circle's own Crew (see
    // getCrewOfferings/getCrewOffersAction) or the owner's own profile self-display.
    // Needed so isAuthorized/hasFeatureAccessIgnoringVerification can evaluate feature
    // access for content rendered from a map-sourced circle (e.g. song comments in the
    // map popup's TrackPreviewList) — without these, hasFeatureAccessIgnoringVerification
    // sees no accessRules at all and denies every feature check unconditionally, regardless
    // of the viewer's actual permissions.
    accessRules: 1,
    enabledModules: 1,
} as const;

// viewerDid is optional for backward compatibility with internal callers that don't render
// tourTeamOfferings at all, but every caller that returns these circles to an end user (pins,
// bookmarks, the circles list) should pass it — Crew Offers have no visibility field of their
// own (see tourTeamOfferingSchema) and must never reach a viewer who isn't that circle's own
// owner, a platform admin, or going through the dedicated crew-scoped getCrewOfferings flow.
// Bookmarking/pinning someone else's profile is not consent to see their Crew Offers.
export const getCirclesByIds = async (ids: string[], viewerDid?: string): Promise<Circle[]> => {
    let objectIds = ids.map((id) => new ObjectId(id));
    let circles = await Circles.find({ _id: { $in: objectIds } }, { projection: SAFE_CIRCLE_PROJECTION }).toArray();
    const viewerIsAdmin = await resolveViewerIsAdmin(viewerDid);
    circles.forEach((circle: Circle) => {
        if (!(viewerIsAdmin || (!!viewerDid && circle.did === viewerDid))) {
            circle.tourTeamOfferings = undefined;
        }
        if (circle._id) {
            circle._id = circle._id.toString();
        }
    });
    return circles;
};

export const getCirclesByDids = async (dids: string[]): Promise<Circle[]> => {
    let circles = await Circles.find({ did: { $in: dids } }, { projection: SAFE_CIRCLE_PROJECTION }).toArray();
    circles.forEach((circle: Circle) => {
        if (circle._id) {
            circle._id = circle._id.toString();
        }
    });
    return circles;
};

export const getDefaultCircle = async (inServerConfig: ServerSettings | null = null): Promise<Circle> => {
    if (process.env.IS_BUILD === "true") {
        return createDefaultCircle();
    }

    let serverConfig = inServerConfig ?? (await getServerSettings());
    let circle = (await Circles.findOne(
        { _id: new ObjectId(serverConfig?.defaultCircleId) },
        { projection: SAFE_CIRCLE_PROJECTION },
    )) as Circle;

    if (!circle) {
        return createDefaultCircle();
    }

    if (circle._id) {
        circle._id = circle._id.toString();
    }

    return circle;
};

// The pilot-signup-provisioned artist circle (see createPilotArtistCircle in
// src/components/forms/signup/actions.ts) a user owns, if any — used both to decide where a
// freshly-verified artist-path signup should land (see verifyEmailAction in
// src/app/(auth)/verify-email/actions.ts) and to branch the post-signup welcome dialog copy
// (src/components/modules/home/home-content.tsx) away from telling someone who already has
// one to go create it via the Create button.
export const getAutoProvisionedArtistCircle = async (userDid: string): Promise<Circle | null> => {
    const circle = (await Circles.findOne(
        {
            createdBy: userDid,
            circleType: { $ne: "user" },
            "metadata.peerify.autoProvisionedFromSignup": true,
        },
        { projection: SAFE_CIRCLE_PROJECTION },
    )) as Circle | null;

    if (circle?._id) {
        circle._id = circle._id.toString();
    }
    return circle;
};

export const hasAutoProvisionedArtistCircle = async (userDid: string): Promise<boolean> =>
    (await getAutoProvisionedArtistCircle(userDid)) !== null;

export const getCirclePublishStatus = (circle?: Partial<Circle> | null): CirclePublishStatus =>
    circle?.publishStatus ?? "published";

export const isCirclePublished = (circle?: Partial<Circle> | null): boolean =>
    getCirclePublishStatus(circle) === "published";

export const getPublishedCircleQuery = (): any => ({
    $or: [{ publishStatus: "published" as const }, { publishStatus: { $exists: false } }],
});

// Shared "is this viewer a platform admin" check, resolved from a trusted DB lookup on their own
// did — never accepted as a caller-supplied boolean. Used anywhere a read path needs to decide
// whether a viewer bypasses per-owner content restrictions (map visibility, location precision,
// crew-only fields), mirroring the pattern getSwipeCircles/searchDiscoverableCircles established.
export const resolveViewerIsAdmin = async (viewerDid?: string): Promise<boolean> => {
    if (!viewerDid) return false;
    const viewer = await Circles.findOne({ did: viewerDid }, { projection: { isAdmin: 1 } });
    return viewer?.isAdmin === true;
};

// Superadmins (user.isAdmin — see src/lib/auth/verification.ts) see every personal profile on
// the map, including ones the owner hasn't opted into mapVisible for. isAdmin is resolved here
// from a trusted DB lookup on viewerDid, never accepted as a caller-supplied boolean, so a client
// can't just claim to be an admin. getPublishedCircleQuery() is applied identically either way.
export const getSwipeCircles = async (viewerDid?: string): Promise<Circle[]> => {
    let circles: Circle[] = [];

    let isAdmin = false;
    if (viewerDid) {
        const viewer = await Circles.findOne({ did: viewerDid }, { projection: { isAdmin: 1 } });
        isAdmin = viewer?.isAdmin === true;
    }

    const mapVisibilityClause = isAdmin
        ? undefined
        : {
              $or: [{ circleType: { $ne: "user" } }, { $and: [{ circleType: "user" }, { mapVisible: true }] }],
          };

    circles = await Circles.find(
        mapVisibilityClause
            ? { $and: [getPublishedCircleQuery(), mapVisibilityClause] }
            : getPublishedCircleQuery(),
        { projection: DISCOVERY_CIRCLE_PROJECTION },
    ).toArray();

    circles.forEach((circle: Circle) => {
        if (circle._id) {
            circle._id = circle._id.toString();
        }
    });
    circles = filterLocations(circles, (circle) => circle.did, { viewerDid, viewerIsAdmin: isAdmin });
    return circles;
};

// Internal-only projection for the Offers map layer — deliberately separate from
// DISCOVERY_CIRCLE_PROJECTION (see that constant's comment) so getSwipeCircles/the main map
// query is completely untouched. No `did` here — unlike the general filterLocations/
// redactLocationForViewer path, offer-pin location is never viewer-aware (see
// getOfferPinLocation below), so there's no owner comparison to project it for.
const OFFER_MAP_PIN_PROJECTION = {
    _id: 1,
    location: 1,
    tourTeamOfferings: 1,
} as const;

type OfferMapCircleRow = {
    _id: string;
    location?: Location;
    tourTeamOfferings?: TourTeamOffering[];
};

// Offer-pin location is decoupled entirely from the profile's own location.precision-gated
// redaction (filterLocations/redactLocationForViewer) and from viewer identity — no owner/admin
// bypass, same value for everyone. Two cases:
// - precision === 4 (Exact): use the real lngLat unchanged. Covers venues/businesses (once they
//   can set offerings — not yet, see getOfferMapPins's own comment) who've already consented to
//   precise findability by setting Exact precision; being precisely findable is the point of a
//   venue listing.
// - anything below Exact: a circle's own precision choice governs OTHER surfaces (their own
//   profile pin, search results, etc.) but must never silently block Offers pins from rendering
//   at all — that was a real bug (toggle on, count shows, no pin, no explanation why). Falls back
//   to a fixed, coarse ~1km-resolution coordinate (snapped to the nearest 0.01° grid point)
//   instead, so a pin always renders once offersVisible is on, regardless of what precision the
//   profile happens to have chosen for unrelated purposes.
const OFFER_PIN_COARSE_GRID_DEGREES = 0.01;

function getOfferPinLocation(location: Location | undefined): Location | undefined {
    if (!location?.lngLat) {
        return location;
    }
    if (location.precision === 4) {
        return location;
    }
    return {
        ...location,
        street: undefined,
        lngLat: {
            lng: Math.round(location.lngLat.lng / OFFER_PIN_COARSE_GRID_DEGREES) * OFFER_PIN_COARSE_GRID_DEGREES,
            lat: Math.round(location.lngLat.lat / OFFER_PIN_COARSE_GRID_DEGREES) * OFFER_PIN_COARSE_GRID_DEGREES,
        },
    };
}

// Global, cross-circle query for Offer map pins — one pin PER OFFER, not per circle. A circle
// with 3 offerings produces 3 pins here, each carrying only that one offering's type/label and
// the circle's (redacted) location — never the circle's did/name/handle/picture/circleType.
// Offers are meant to be browsable before any Crew/artist relationship exists and the host's
// identity stays hidden until they choose to reveal it (not yet built — see the anonymized-
// contact-thread design), so this map layer must never carry identity in the first place.
//
// Deliberately NOT scoped through Members/crew-membership the way getCrewOfferings
// (lib/data/member.ts) is — tourTeamOfferings is set once on a user's own profile
// (presence-settings-form.tsx only ever renders this field for circleType: "user", never for a
// band/venue circle), not per band-relationship, so there is no "circle X's crew" to scope this
// to. { circleType: "user" } below is deliberate for the same reason — venues/businesses have no
// UI path to set tourTeamOfferings at all today, so they can never appear here regardless of
// location precision. Whether/how venues participate in Offers (editor UI, whether this query
// should include circleType: "circle", whether offersVisible applies the same way) is a separate,
// real feature decision, not folded into this fix.
// This is a plain Circles query shaped like getSwipeCircles, but the consent gate is its own
// dedicated field — offersVisible, NOT mapVisible/searchable — bypassed only for platform admins.
// A circle can show offer pins while otherwise fully private (no profile pin, not searchable):
// offer pins carry zero identity of the offering circle already, so there's no reason to couple
// this to the personal-profile-pin/search-discoverability flags, which gate identity-bearing
// surfaces. crewVisible/crew-membership is a separate, narrower concern (who a circle's own crew
// roster shows to its own admins/moderators) with nothing to do with public map consent, and is
// deliberately not consulted here either.
export const getOfferMapPins = async (viewerDid?: string): Promise<OfferMapPin[]> => {
    const viewerIsAdmin = await resolveViewerIsAdmin(viewerDid);

    const offersVisibleClause = viewerIsAdmin ? undefined : { offersVisible: true };
    const query = {
        $and: [
            getPublishedCircleQuery(),
            { circleType: "user" },
            { tourTeamOfferings: { $exists: true, $not: { $size: 0 } } },
            ...(offersVisibleClause ? [offersVisibleClause] : []),
        ],
    };

    let rows = (await Circles.find(query, { projection: OFFER_MAP_PIN_PROJECTION }).toArray()) as unknown as OfferMapCircleRow[];
    rows.forEach((row) => {
        if (row._id) {
            row._id = row._id.toString();
        }
    });

    // Flatten: one entry per offering. Trimmed to {type, label} for every viewer alike — mirrors
    // sanitizePeerifyPublicEventDisplay's "one consistent public shape regardless of who's
    // asking" pattern (event.ts) — no detail/accommodationType, same as before.
    // did/name/handle/picture/circleType/offersVisible are dropped entirely, not just omitted
    // from this trim step — OfferMapPin has no fields for them. Location goes through
    // getOfferPinLocation, not filterLocations/redactLocationForViewer — see that function's own
    // comment for why offer-pin location is deliberately not viewer-aware.
    const pins: OfferMapPin[] = [];
    for (const row of rows) {
        for (const offering of row.tourTeamOfferings ?? []) {
            pins.push({
                _id: `${row._id}:${offering.id}`,
                location: getOfferPinLocation(row.location),
                offerType: offering.type,
                offerLabel: offering.type === "custom" ? offering.label : undefined,
            });
        }
    }
    return pins;
};

export const getCircles = async (
    parentCircleId?: string,
    circleType?: CircleType,
    sdgHandles?: string[],
    userDid?: string,
    includeCreated?: boolean,
    includeMember?: boolean,
): Promise<Circle[]> => {
    let query: any = { $and: [{ circleType: circleType ?? "circle" }, getPublishedCircleQuery()] };
    if (parentCircleId) {
        query.$and.push({ parentCircleId });
    }
    if (sdgHandles && sdgHandles.length > 0) {
        query.$and.push({ causes: { $in: sdgHandles } });
    }

    if (userDid && circleType === "circle") {
        const userCircle = await Circles.findOne({ did: userDid, circleType: "user" });
        if (userCircle && userCircle._id.toString() === parentCircleId) {
            const userQueries = [];
            if (includeCreated) {
                userQueries.push({ createdBy: userDid });
            }
            if (includeMember) {
                const memberships = await Members.find({ userDid }).toArray();
                const circleIds = memberships.map((m) => new ObjectId(m.circleId));
                userQueries.push({ _id: { $in: circleIds } });
            }

            if (userQueries.length > 0) {
                query = {
                    $and: [
                        { circleType: "circle" },
                        {
                            $or: [{ $and: [{ parentCircleId }, getPublishedCircleQuery()] }, ...userQueries],
                        },
                    ],
                };
            }
        }
    }

    let circles = await Circles.find(query, { projection: SAFE_CIRCLE_PROJECTION }).toArray();
    circles.forEach((circle: Circle) => {
        if (circle._id) {
            circle._id = circle._id.toString();
        }
    });
    //circles = filterLocations(circles) as any[];
    return circles;
};

export const countCirclesAndUsers = async (): Promise<PlatformMetrics> => {
    const circles = await Circles.countDocuments({ circleType: "circle" });
    const users = await Circles.countDocuments({ circleType: "user" });

    return { circles, users };
};

export const getCirclesWithMetrics = async (
    userDid?: string,
    parentCircleId?: string,
    sort?: SortingOptions,
    circleType?: CircleType,
    sdgHandles?: string[],
    includeCreated?: boolean,
    includeMember?: boolean,
): Promise<WithMetric<Circle>[]> => {
    let circles = (await getCircles(
        parentCircleId,
        circleType,
        sdgHandles,
        userDid,
        includeCreated,
        includeMember,
    )) as WithMetric<Circle>[];

    console.log("🔍 [DB] getCirclesWithMetrics query:", { userDid, parentCircleId, sort, circleType });
    const currentDate = new Date();
    let user = undefined;
    if (userDid) {
        user = (await Circles.findOne({ did: userDid }, { projection: SAFE_CIRCLE_PROJECTION })) ?? undefined;
    }

    // get metrics for each circle
    for (const circle of circles) {
        circle.metrics = await getMetrics(user, circle, currentDate, sort);
    }

    // sort circles by rank
    circles.sort((a, b) => (a.metrics?.rank ?? 0) - (b.metrics?.rank ?? 0));

    console.log("🔍 [DB] getCirclesWithMetrics result:", {
        count: circles.length,
        userDid,
        parentCircleId,
        sort,
        circleType,
    });
    return circles;
};

export const getMetricsForCircles = async (
    circles: WithMetric<Circle>[],
    userDid: string | undefined,
    sort?: SortingOptions,
) => {
    const currentDate = new Date();
    let user = undefined;
    if (userDid) {
        user = (await Circles.findOne({ did: userDid }, { projection: SAFE_CIRCLE_PROJECTION })) ?? undefined;
    }

    // get metrics for each circle
    for (const circle of circles) {
        circle.metrics = await getMetrics(user, circle, currentDate, sort);
    }

    // sort circles by rank
    circles.sort((a, b) => (a.metrics?.rank ?? 0) - (b.metrics?.rank ?? 0));
    return circles;
};

export const createDefaultCircle = (): Circle => {
    let circle: Circle = {
        name: "Kamooni",
        description: "Connect. Collaborate. Create Change.",
        handle: "default",
        picture: { url: "/images/default-picture.png" },
        userGroups: defaultUserGroups,
        enabledModules: getDefaultModules("circle"),
        accessRules: getDefaultAccessRules(),
        questionnaire: [],
        isPublic: true,
        showAdminsPublicly: false,
        circleType: "circle",
        circleLevel: "top_level",
        publishStatus: "published",
    };
    return circle;
};

export const createCircle = async (circle: Circle, authenticatedUserDid: string): Promise<Circle> => {
    if (!circle?.name || !circle?.handle) {
        throw new Error("Missing required fields");
    }
    if (!authenticatedUserDid) {
        // Ensure we have the creator's DID
        throw new Error("Authenticated user DID is required to create a circle.");
    }

    // check if handle is already in use
    let existingCircle = await Circles.findOne({ handle: circle.handle }, { projection: SAFE_CIRCLE_PROJECTION });
    if (existingCircle) {
        throw new Error("Handle already in use");
    }

    circle.createdAt = new Date();
    circle.userGroups = defaultUserGroups;

    // Set default enabled modules based on circle type
    let defaultModules = getDefaultModules(circle.circleType ?? "circle");

    // Community and Crew used to be force-shown in the nav regardless of enabledModules
    // (see circle-tabs.tsx / isModuleEnabled()) rather than being real defaults here — that
    // hack is gone now, so new circles must actually get them enabled at creation to keep the
    // same out-of-the-box visibility. Existing circles are backfilled separately (one-time
    // migration), since this only runs on insert.
    if ((circle.circleType ?? "circle") === "circle") {
        defaultModules = [...defaultModules, "community"];
    }
    if (isPeerifyArtistIdentity(circle)) {
        defaultModules = [...defaultModules, "crew"];
    }

    // Set the enabledModules
    circle.enabledModules = circle.enabledModules || defaultModules;

    // Set the access rules
    circle.accessRules = getDefaultAccessRules();
    circle.questionnaire = [];
    circle.circleType = circle.circleType || "circle";
    circle.circleLevel = circle.circleLevel || (circle.parentCircleId ? "profile_child" : "top_level");
    circle.publishStatus = circle.publishStatus || (circle.circleType === "user" ? "published" : "draft");
    circle.showAdminsPublicly = circle.showAdminsPublicly ?? false;
    if (circle.circleType === "user") {
        circle.mapVisible = circle.mapVisible ?? false;
        circle.searchable = circle.searchable ?? false;
        // Defaults true for newly-created circles only — an explicit product decision, not the
        // same default as mapVisible/searchable. Existing circles created before this field
        // existed are unaffected (this line only runs in createCircle, never on an update), and
        // stay excluded from getOfferMapPins's exact-match {offersVisible: true} query until
        // their owner explicitly turns the Presence-settings toggle on — no retroactive backfill.
        circle.offersVisible = circle.offersVisible ?? true;
    }
    if (!hasCircleImages(circle.images)) {
        circle.images = [getDefaultHeroImage(circle.handle || circle.did || circle.name)];
    }

    let result = await Circles.insertOne(circle);
    circle._id = result.insertedId.toString();

    // update circle embedding
    try {
        await upsertVbdCircles([circle]);
    } catch (e) {
        console.error("Failed to upsert circle embedding", e);
    }

    // create circle chat room, passing the creator's DID
    try {
        await createDefaultChatRooms(circle._id, authenticatedUserDid);
    } catch (e) {
        console.error("Failed to create chat rooms", e);
    }

    // create default feed
    try {
        await createDefaultFeed(circle._id);
    } catch (e) {
        console.error("Failed to create default feed", e);
    }

    return circle;
};

export const getCircleByHandle = async (handle: string): Promise<Circle> => {
    let circle = (await Circles.findOne({ handle: handle }, { projection: SAFE_CIRCLE_PROJECTION })) as Circle;
    if (circle?._id) {
        circle._id = circle._id.toString();
    }
    return circle;
};

export const getCircleById = async (id: string | null, criteria?: any): Promise<Circle> => {
    let query = id ? { _id: new ObjectId(id) } : criteria;
    let circle = (await Circles.findOne(query, { projection: SAFE_CIRCLE_PROJECTION })) as Circle;

    if (circle?._id) {
        circle._id = circle._id.toString();
    }
    return circle;
};

export const getCircleByDid = async (did: string): Promise<Circle> => {
    let circle = (await Circles.findOne({ did: did }, { projection: SAFE_CIRCLE_PROJECTION })) as Circle;
    if (circle?._id) {
        circle._id = circle._id.toString();
    }
    return circle;
};

// The draft/pending_verification->published completion bar for a pilot-signup-provisioned
// artist circle (see createPilotArtistCircle in src/components/forms/signup/actions.ts):
// its own picture + About text + map location are filled in, and its creator has signed
// all Community Guidelines rules. Publish is manual (see the "Publish circle"/"Publish
// profile" actions in src/app/circles/[handle]/settings/about/actions.ts and
// src/app/profiles/actions.ts) — isPilotArtistCircleReadyToPublish only computes readiness;
// it never mutates publishStatus. Those two actions call it directly to re-validate
// server-side before flipping publishStatus, so someone can't bypass the gate by hitting
// the endpoint directly with a stale disabled button state.
const getPilotArtistCircleReadinessFlags = async (
    artistCircle: Partial<Circle>,
): Promise<{ picture: boolean; aboutText: boolean; location: boolean; guidelines: boolean }> => {
    const picture = hasCustomPicture(artistCircle);
    const aboutText = hasAboutText(artistCircle);
    const location = hasLocationSet(artistCircle);

    let guidelines = false;
    if (artistCircle.createdBy) {
        const creator = await Circles.findOne(
            { did: artistCircle.createdBy },
            { projection: { communityGuidelinesAcceptance: 1 } },
        );
        guidelines = isCommunityGuidelinesCompleted(creator?.communityGuidelinesAcceptance as any);
    }

    return { picture, aboutText, location, guidelines };
};

export const isPilotArtistCircleReadyToPublish = async (artistCircle: Partial<Circle>): Promise<boolean> => {
    const flags = await getPilotArtistCircleReadinessFlags(artistCircle);
    return flags.picture && flags.aboutText && flags.location && flags.guidelines;
};

// Per-item breakdown of the same bar above, for the Step 2 checklist banner
// (src/app/circles/[handle]/settings/about/page.tsx) — reuses VerificationReadinessChecklist,
// the same component the pre-existing generic verification checklist uses.
export const getPilotArtistCircleReadiness = async (artistCircle: Partial<Circle>): Promise<VerificationReadiness> => {
    const flags = await getPilotArtistCircleReadinessFlags(artistCircle);
    const items: VerificationReadinessItem[] = [
        { key: "picture", label: "Add a picture", complete: flags.picture },
        { key: "aboutText", label: "Add About text", complete: flags.aboutText },
        { key: "location", label: "Set your map location", complete: flags.location },
        {
            key: "guidelines",
            label: "Sign the Community Guidelines (on your personal profile, step 1)",
            complete: flags.guidelines,
        },
    ];

    return {
        isReady: items.every((item) => item.complete),
        title: "Step 2 of 2: Complete your public artist profile",
        items,
    };
};

// Self-heals a circle's userGroups to include "crew" the first time it's actually needed
// (e.g. a Crew application is approved), instead of requiring a one-off migration to backfill
// every circle created before the Crew tier existed. Matches the shape Commit 1 added to
// defaultUserGroups so every circle ends up with an identical Crew group definition. The
// "userGroups.handle": { $ne: "crew" } filter makes this idempotent/race-safe — concurrent
// approvals for the same circle can't both push a duplicate entry.
export const ensureCrewUserGroupOnCircle = async (circleId: string): Promise<void> => {
    const crewGroup = defaultUserGroups.find((group) => group.handle === "crew");
    if (!crewGroup) return;

    await Circles.updateOne(
        { _id: new ObjectId(circleId), "userGroups.handle": { $ne: "crew" } },
        { $push: { userGroups: crewGroup } },
    );
};

export const updateCircle = async (circle: Partial<Circle>, authenticatedUserDid: string): Promise<void> => {
    const { _id, ...circleWithoutId } = circle;
    if (!_id) {
        throw new Error("Circle ID is required for update");
    }

    // Fetch the existing circle to check ownership for user circles
    const existingCircle = await getCircleById(_id);
    if (!existingCircle) {
        throw new Error("Circle not found");
    }

    // Authorization check: If it's a user circle, ensure the authenticated user owns it
    if (existingCircle.circleType === "user") {
        if (!authenticatedUserDid || existingCircle.did !== authenticatedUserDid) {
            console.error(
                `Unauthorized attempt to update user circle. Circle DID: ${existingCircle.did}, Authenticated DID: ${authenticatedUserDid}`,
            );
            throw new Error("Unauthorized: Cannot update another user's circle profile.");
        }
    }
    // Note: For non-user circles, authorization is assumed to be handled by the calling action using isAuthorized()

    // Prevent critical fields from being overwritten
    delete circleWithoutId.did; // DID should never change
    delete circleWithoutId.email; // Email should likely be updated via a separate, dedicated process if needed
    delete circleWithoutId.circleType; // CircleType should not change after creation

    // Check for handle conflict if handle is being updated
    if (circleWithoutId.handle && circleWithoutId.handle !== existingCircle.handle) {
        const conflictingCircle = await Circles.findOne({
            handle: circleWithoutId.handle,
            _id: { $ne: new ObjectId(_id) }, // Exclude the current circle
        });
        if (conflictingCircle) {
            throw new Error(`Handle "${circleWithoutId.handle}" is already in use.`);
        }
    }

    // Proceed with the update
    let result = await Circles.updateOne({ _id: new ObjectId(_id) }, { $set: circleWithoutId });
    if (result.matchedCount === 0) {
        // This should theoretically not happen due to the getCircleById check above, but keep for safety
        throw new Error("Circle not found during update operation");
    }

    // update circle embedding
    let c = await getCircleById(_id);

    // Personal profiles auto-verify (no admin action) once picture + about text are both filled in.
    // Forward-only: never revokes isVerified if those fields are later cleared.
    if (c.circleType === "user" && !c.isVerified && getVerificationReadiness(c).isReady) {
        await Circles.updateOne(
            { _id: new ObjectId(_id) },
            { $set: { ...buildVerifiedUserSet("system:auto-verified"), accountStatus: "active" } },
        );
        c = await getCircleById(_id);

        // Dynamic import avoids a circular dependency: notifications.ts imports from circle.ts.
        try {
            const { sendUserVerifiedNotification } = await import("./notifications");
            // getVerificationReadiness (picture+about+guidelines) deliberately excludes location —
            // it's genuinely optional for participation and that's not changing here. But claiming
            // the profile is "complete" is only accurate when location is ALSO set, since that's
            // still part of isPilotPersonalPhaseComplete's (the onboarding flow's own) definition
            // of a finished personal profile. Check it just for wording, not to gate anything.
            const message = hasLocationSet(c)
                ? "Your profile is complete! You can now post, comment, and message on Peerify."
                : "You can now post, comment, and message on Peerify!";
            await sendUserVerifiedNotification(c as any, message);
        } catch (e) {
            console.error("Failed to send auto-verification notification", e);
        }
    }

    try {
        await upsertVbdCircles([c]);
    } catch (e) {
        console.error("Failed to upsert circle embedding", e);
    }

    // update circle chat room
    const membersChat = await getChatRoomByHandle(_id.toString(), "members");
    if (membersChat) {
        await updateChatRoom({
            _id: membersChat._id,
            name: circle.name, // keep chat name in sync
            picture: circle.picture, // keep chat avatar in sync
        });
    }
};

export const getCirclePath = async (circle: Partial<Circle>): Promise<string> => {
    let serverConfig = await getServerSettings();
    if (circle._id === serverConfig.defaultCircleId) {
        return "/";
    }
    return `/circles/${circle.handle}/`;
};

export const getCirclesBySearchQuery = async (query: string, limit: number = 10, circleType?: CircleType) => {
    const regex = new RegExp(query, "i"); // case-insensitive search
    const filter: any = { name: regex };
    if (circleType) {
        filter.circleType = circleType;
    }
    const circles = await Circles.find(filter, { projection: SAFE_CIRCLE_PROJECTION }).limit(limit).toArray();
    circles.forEach((circle: Circle) => {
        if (circle._id) {
            circle._id = circle._id.toString();
        }
    });
    return circles as Circle[];
};

/**
 * Find a project by its shadow post ID (used for project comment notifications)
 */
export const findProjectByShadowPostId = async (postId: string): Promise<Circle | null> => {
    console.log("🔍 [DB] findProjectByShadowPostId query:", { postId });

    // Direct query for the project
    let query = { "metadata.commentPostId": postId, circleType: "project" as CircleType };

    let project = (await Circles.findOne(query, { projection: SAFE_CIRCLE_PROJECTION })) as Circle;

    if (project?._id) {
        project._id = project._id.toString();
        console.log("🔍 [DB] Found project for shadow post:", {
            postId,
            projectId: project._id,
            projectName: project.name,
        });
    } else {
        console.log("🔍 [DB] No project found for shadow post:", { postId });
    }

    return project || null;
};

/**
 * Delete a circle and all associated data
 * @param circleId The ID of the circle to delete
 */
export const deleteCircle = async (circleId: string): Promise<void> => {
    console.log("🗑️ [DB] Deleting circle:", circleId);

    // Get the circle to be deleted
    const circle = await getCircleById(circleId);
    if (!circle) {
        throw new Error("Circle not found");
    }

    // Delete the circle from the database
    const result = await Circles.deleteOne({ _id: new ObjectId(circleId) });

    if (result.deletedCount === 0) {
        throw new Error("Failed to delete circle");
    }

    // Delete all members of the circle
    await Members.deleteMany({ circleId: circleId });

    // This circle may itself be a member/follower of other circles (its did is
    // used as userDid in those circles' Members rows). Clean those up too and
    // decrement the corresponding stored counters, or those circles' member
    // counts drift upward forever every time an account is deleted.
    if (circle.did) {
        const otherMemberships = await Members.find({ userDid: circle.did }).toArray();
        if (otherMemberships.length > 0) {
            const countByCircleId = new Map<string, number>();
            for (const membership of otherMemberships) {
                countByCircleId.set(membership.circleId, (countByCircleId.get(membership.circleId) || 0) + 1);
            }

            await Members.deleteMany({ userDid: circle.did });

            for (const [otherCircleId, count] of countByCircleId) {
                await Circles.updateOne({ _id: new ObjectId(otherCircleId) }, { $inc: { members: -count } });
            }
        }
    }

    // Delete all membership requests for the circle
    await MembershipRequests.deleteMany({ circleId: circleId });

    // Delete all feeds associated with the circle
    const feeds = await Feeds.find({ circleId: circleId }).toArray();
    const feedIds = feeds.map((feed) => feed._id.toString());

    await Feeds.deleteMany({ circleId: circleId });

    // Get all posts in the feeds to delete them from vector database later
    interface PostWithId {
        _id: ObjectId | string;
    }

    let allPosts: PostWithId[] = [];
    for (const feedId of feedIds) {
        const posts = await Posts.find({ feedId: feedId }).toArray();
        allPosts = [...allPosts, ...posts.map((post) => ({ _id: post._id }))];
        // Delete posts from MongoDB
        await Posts.deleteMany({ feedId: feedId });
    }

    // Delete all chat rooms associated with the circle
    await ChatRooms.deleteMany({ circleId: circleId });

    // Delete circle from vector database
    try {
        await deleteVbdCircle(circleId);
        console.log("🗑️ [VDB] Circle deleted from vector database:", circleId);
    } catch (error) {
        console.error("Error deleting circle from vector database:", error);
    }

    // Delete all posts from vector database
    for (const post of allPosts) {
        try {
            await deleteVbdPost(post._id.toString());
        } catch (error) {
            console.error("Error deleting post from vector database:", error);
        }
    }

    // If the circle is a user, delete the user files
    if (circle.circleType === "user" && circle.did) {
        try {
            const userDir = path.join(USERS_DIR, circle.did);
            if (fs.existsSync(userDir)) {
                fs.rmSync(userDir, { recursive: true, force: true });
                console.log("🗑️ [FS] User directory deleted:", userDir);
            }
        } catch (error) {
            console.error("Error deleting user files:", error);
        }
    }

    console.log("🗑️ [DB] Circle deleted successfully:", circleId);
};

/**
 * Ensures a specific module is enabled on a user's own circle.
 * @param circleId The ID of the user's circle.
 * @param moduleHandle The handle of the module to enable.
 * @param currentUserDid The DID of the currently authenticated user.
 * @returns True if the module was enabled or already enabled, false otherwise.
 */
export const ensureModuleIsEnabledOnCircle = async (
    circleId: string,
    moduleHandle: string,
    currentUserDid: string,
): Promise<boolean> => {
    try {
        const circle = await getCircleById(circleId);

        if (!circle) {
            console.warn(`[ensureModuleIsEnabledOnCircle] Circle not found: ${circleId}`);
            return false;
        }

        // This function is intended only for user circles (user profiles)
        if (circle.circleType !== "user") {
            console.log(
                `[ensureModuleIsEnabledOnCircle] Skipping module enablement for non-user circle: ${circleId}, type: ${circle.circleType}`,
            );
            return true; // Not an error, but no action taken for non-user circles
        }

        // Verify the currentUserDid matches the circle's owner DID
        if (circle.did !== currentUserDid) {
            console.error(
                `[ensureModuleIsEnabledOnCircle] Unauthorized attempt to enable module. User DID ${currentUserDid} does not own circle ${circleId} (owner DID: ${circle.did})`,
            );
            return false;
        }

        const currentEnabledModules = circle.enabledModules || [];
        if (currentEnabledModules.includes(moduleHandle)) {
            console.log(
                `[ensureModuleIsEnabledOnCircle] Module ${moduleHandle} already enabled for circle ${circleId}`,
            );
            return true;
        }

        const newEnabledModules = [...currentEnabledModules, moduleHandle];
        await updateCircle({ _id: circleId, enabledModules: newEnabledModules }, currentUserDid);
        console.log(`[ensureModuleIsEnabledOnCircle] Module ${moduleHandle} enabled for circle ${circleId}`);
        return true;
    } catch (error) {
        console.error(
            `[ensureModuleIsEnabledOnCircle] Error enabling module ${moduleHandle} for circle ${circleId}:`,
            error,
        );
        return false;
    }
};
