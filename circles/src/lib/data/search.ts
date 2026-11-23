import { Circle, CircleType, WithMetric } from "@/models/models";
import { Circles } from "./db";
import { getPublishedCircleQuery, isCirclePublished, SAFE_CIRCLE_PROJECTION } from "./circle";
import { toPublicCircleListItem } from "../utils/public-circle";
import { toLimitedPersonalListItem } from "../peerify/personal-profile-access";
import { getAcceptedConnectionDids, getFullProfileOwnerDids } from "./personal-profile-access";
import { escapeRegex } from "../utils";
import {
    buildActFilterMongoQuery,
    getAvailableActOffers,
    isPeerifyArtistIdentity,
    type PeerifyActFilters,
    type PeerifyActOffer,
} from "../peerify/artist-profile";

const SEARCHABLE_TYPES: CircleType[] = ["circle", "project", "user"];
const SEARCHABLE_FIELDS = [
    "name",
    "handle",
    "description",
    "mission",
    "content",
    "skills",
    "interests",
    "causes",
    "primaryGenres",
    "offers.text",
    "offers.skills",
    "engagements.text",
    "engagements.interests",
    "needs.text",
    "needs.tags",
    "location.city",
    "location.region",
    "location.country",
] as const;

type SearchCirclesOptions = {
    query?: string;
    limit?: number;
    circleTypes?: CircleType[];
    primaryGenres?: string[];
    // Act format / What you do: narrows artist profiles only, other circles pass.
    actFilters?: PeerifyActFilters;
    viewerDid?: string;
};

const normalizeValue = (value?: string | null) => (value || "").trim().toLowerCase();

const tokenizeQuery = (query: string) =>
    Array.from(
        new Set(
            normalizeValue(query)
                .replace(/^@/, "")
                .split(/[^a-z0-9]+/i)
                .filter((token) => token.length > 1),
        ),
    );

const toStringArray = (values?: string[]) => (values || []).map((value) => normalizeValue(value)).filter(Boolean);

// viewerIsAdmin (resolved by the caller from a trusted DB lookup, never a caller-supplied
// boolean — see searchDiscoverableCircles) lets superadmins see personal profiles the owner
// hasn't opted into searchable for. Mirrors getSwipeCircles' mapVisible bypass in circle.ts.
// connectionDids: the viewer's accepted connections, found even with search off (Tim, 2026-11-23).
const isDiscoverableCircle = (circle: Circle, viewerIsAdmin: boolean, connectionDids?: Set<string>) =>
    viewerIsAdmin ||
    circle.circleType !== "user" ||
    Boolean(circle.searchable) ||
    (!!circle.did && !!connectionDids?.has(circle.did));

const matchesCircleTypes = (circle: Circle, circleTypes: CircleType[]) =>
    !!circle.circleType && circleTypes.includes(circle.circleType);

const getLocationTerms = (circle: Circle) =>
    [circle.location?.city, circle.location?.region, circle.location?.country].map((value) => normalizeValue(value));

const getExactTerms = (circle: Circle) => ({
    handle: normalizeValue(circle.handle),
    name: normalizeValue(circle.name),
});

const getStructuredTerms = (circle: Circle) =>
    [
        ...toStringArray(circle.skills),
        ...toStringArray(circle.interests),
        ...toStringArray(circle.causes),
        ...toStringArray(circle.primaryGenres),
        ...toStringArray(circle.offers?.skills),
        ...toStringArray(circle.engagements?.interests),
        ...toStringArray(circle.needs?.tags),
        ...getLocationTerms(circle),
    ].filter(Boolean);

const getLongTextTerms = (circle: Circle) =>
    [
        circle.description,
        circle.mission,
        circle.content,
        circle.offers?.text,
        circle.engagements?.text,
        circle.needs?.text,
    ]
        .map((value) => normalizeValue(value))
        .filter(Boolean);

const scoreQueryAgainstValues = (query: string, tokens: string[], values: string[], weights: { exact: number; prefix: number; contains: number }) => {
    let score = 0;

    for (const value of values) {
        if (!value) continue;

        if (query && value === query) {
            score += weights.exact;
        } else if (query && value.startsWith(query)) {
            score += weights.prefix;
        } else if (query && value.includes(query)) {
            score += weights.contains;
        }

        for (const token of tokens) {
            if (value === token) {
                score += Math.round(weights.exact * 0.55);
            } else if (value.startsWith(token)) {
                score += Math.round(weights.prefix * 0.45);
            } else if (value.includes(token)) {
                score += Math.round(weights.contains * 0.35);
            }
        }
    }

    return score;
};

const scoreCircleSearchMatch = (circle: Circle, query: string, tokens: string[]) => {
    if (!query && tokens.length === 0) {
        return 1;
    }

    const exactTerms = getExactTerms(circle);
    const structuredTerms = getStructuredTerms(circle);
    const longTextTerms = getLongTextTerms(circle);

    let score = 0;
    score += scoreQueryAgainstValues(query, tokens, [exactTerms.name], { exact: 120, prefix: 96, contains: 70 });
    score += scoreQueryAgainstValues(query, tokens, [exactTerms.handle], { exact: 112, prefix: 90, contains: 64 });
    score += scoreQueryAgainstValues(query, tokens, structuredTerms, { exact: 70, prefix: 48, contains: 30 });
    score += scoreQueryAgainstValues(query, tokens, longTextTerms, { exact: 42, prefix: 24, contains: 14 });

    if (circle.circleType === "user") {
        score += 3;
    }

    return score;
};

const buildCandidateQuery = (
    query: string,
    circleTypes: CircleType[],
    primaryGenres: string[],
    viewerIsAdmin: boolean,
    actFilters?: PeerifyActFilters,
    connectionDids: string[] = [],
) => {
    const discoverableTypeClauses: Record<string, unknown>[] = [];
    const nonUserTypes = circleTypes.filter((type) => type !== "user");

    if (nonUserTypes.length > 0) {
        discoverableTypeClauses.push({ circleType: { $in: nonUserTypes } });
    }

    if (circleTypes.includes("user")) {
        discoverableTypeClauses.push(
            viewerIsAdmin
                ? { circleType: "user" }
                : {
                      $and: [
                          { circleType: "user" },
                          connectionDids.length > 0
                              ? { $or: [{ searchable: true }, { did: { $in: connectionDids } }] }
                              : { searchable: true },
                      ],
                  },
        );
    }

    const clauses: Record<string, unknown>[] = [
        {
            $and: [{ $or: discoverableTypeClauses }, getPublishedCircleQuery()],
        },
    ];

    // Mongo's $in against an array field (primaryGenres) matches on any overlap, giving natural
    // OR-matching across however many genres a host selects. A future getGenreCounts() aggregation
    // (grouping circles by primaryGenres for pill result-counts) can reuse this same query shape.
    if (primaryGenres.length > 0) {
        clauses.push({ primaryGenres: { $in: primaryGenres } });
    }

    // In the query, not after it: the candidate limit below would otherwise cut matching artists.
    const actFilterQuery = buildActFilterMongoQuery(actFilters);
    if (actFilterQuery) {
        clauses.push(actFilterQuery);
    }

    if (query) {
        const tokens = [query, ...tokenizeQuery(query)].filter(Boolean);
        const regexes = tokens.map((token) => new RegExp(escapeRegex(token), "i"));
        clauses.push({
            $or: regexes.flatMap((regex) => SEARCHABLE_FIELDS.map((field) => ({ [field]: regex }))),
        });
    }

    return clauses.length === 1 ? clauses[0] : { $and: clauses };
};

// Trusted lookup, not a caller-supplied flag — see isDiscoverableCircle's comment above and
// getSwipeCircles in circle.ts, which resolves its own admin bypass the same way.
const getViewerIsAdmin = async (viewerDid?: string): Promise<boolean> => {
    if (!viewerDid) return false;
    const viewer = await Circles.findOne({ did: viewerDid }, { projection: { isAdmin: 1 } });
    return viewer?.isAdmin === true;
};

// Enough fields for isPeerifyArtistIdentity, the act filters and the discoverability checks.
const ACT_OFFER_AVAILABILITY_PROJECTION = {
    circleType: 1,
    searchable: 1,
    publishStatus: 1,
    "metadata.peerify.intent": 1,
    "metadata.peerify.managedIdentity": 1,
    "metadata.peerify.identityType": 1,
    "metadata.peerify.artistProfile.actFormat": 1,
    "metadata.peerify.artistProfile.actOffers": 1,
} as const;

// A safety cap, far above today's artist count; past it, a rare value could be left out of the row.
const ACT_OFFER_AVAILABILITY_LIMIT = 2000;

/**
 * Which "What you do" values the artists matching this search have (getAvailableActOffers):
 * same candidate query as searchDiscoverableCircles, minus the What you do filter itself and
 * without its result limit, so the filter row offers every value that would find someone.
 * Returns values only, never circles.
 */
export const getAvailableActOffersForSearch = async ({
    query = "",
    circleTypes = SEARCHABLE_TYPES,
    primaryGenres = [],
    actFilters,
    viewerDid,
}: Omit<SearchCirclesOptions, "limit">): Promise<PeerifyActOffer[]> => {
    const viewerIsAdmin = await getViewerIsAdmin(viewerDid);
    const normalizedTypes = circleTypes.length > 0 ? circleTypes : SEARCHABLE_TYPES;
    const candidateQuery = buildCandidateQuery(
        normalizeValue(query),
        normalizedTypes,
        primaryGenres.filter(Boolean),
        viewerIsAdmin,
        { actFormats: actFilters?.actFormats },
    );
    const circles = (await Circles.find(candidateQuery, { projection: ACT_OFFER_AVAILABILITY_PROJECTION })
        .limit(ACT_OFFER_AVAILABILITY_LIMIT)
        .toArray()) as Circle[];
    const visible = circles.filter(
        (circle) =>
            circle.circleType !== "user" && // personal profiles marked as artists are never listed
            isCirclePublished(circle) &&
            isDiscoverableCircle(circle, viewerIsAdmin) &&
            matchesCircleTypes(circle, normalizedTypes),
    );
    return getAvailableActOffers(visible, actFilters);
};

// Personal profiles in search (Tim, 2026-11-23):
// - signed out: none at all;
// - signed in: those with "Show me in search" on (every one for a superadmin, isDiscoverableCircle).
//   The owner, superadmins and accepted connections get the full entry (getFullProfileOwnerDids,
//   the same rule as the profile page). Everyone else gets the limited entry, name, handle and
//   picture (toLimitedPersonalListItem), found by name or handle only: matching on the about text,
//   city, skills or genres would tell a stranger what the profile says.
const scoreLimitedPersonalMatch = (circle: Circle, query: string, tokens: string[]) => {
    const { name, handle } = getExactTerms(circle);
    return (
        scoreQueryAgainstValues(query, tokens, [name], { exact: 120, prefix: 96, contains: 70 }) +
        scoreQueryAgainstValues(query, tokens, [handle], { exact: 112, prefix: 90, contains: 64 })
    );
};

export const searchDiscoverableCircles = async ({
    query = "",
    limit = 20,
    circleTypes = SEARCHABLE_TYPES,
    primaryGenres = [],
    actFilters,
    viewerDid,
}: SearchCirclesOptions): Promise<WithMetric<Circle>[]> => {
    const viewerIsAdmin = await getViewerIsAdmin(viewerDid);

    const normalizedQuery = normalizeValue(query);
    const requestedTypes = circleTypes.length > 0 ? circleTypes : SEARCHABLE_TYPES;
    const normalizedTypes = viewerDid ? requestedTypes : requestedTypes.filter((type) => type !== "user");
    if (normalizedTypes.length === 0) return [];
    const normalizedGenres = primaryGenres.filter(Boolean);
    const candidateLimit = Math.max(limit * 6, 120);
    const connectionList = normalizedTypes.includes("user") ? await getAcceptedConnectionDids(viewerDid) : [];
    const connectionDids = new Set(connectionList);
    const candidateQuery = buildCandidateQuery(
        normalizedQuery,
        normalizedTypes,
        normalizedGenres,
        viewerIsAdmin,
        actFilters,
        connectionList,
    );

    const circles = (await Circles.find(candidateQuery, { projection: SAFE_CIRCLE_PROJECTION }).limit(candidateLimit).toArray()) as Circle[];
    const tokens = tokenizeQuery(normalizedQuery);
    const personalDids = circles.filter((circle) => circle.circleType === "user" && circle.did).map((c) => c.did!);
    const fullPersonalDids = await getFullProfileOwnerDids(viewerDid, personalDids);
    const isLimitedPersonal = (circle: Circle) =>
        circle.circleType === "user" && !(circle.did && fullPersonalDids.has(circle.did));
    // Found only because they're the viewer's connection (search off): by name and handle only.
    const isConnectionOnly = (circle: Circle) =>
        circle.circleType === "user" &&
        !viewerIsAdmin &&
        !circle.searchable &&
        !!circle.did &&
        connectionDids.has(circle.did);

    const scored = circles
        .map((circle) => {
            if (circle._id) {
                circle._id = circle._id.toString();
            }

            const limited = isLimitedPersonal(circle);
            const nameOnly = limited || isConnectionOnly(circle);
            const score = nameOnly
                ? scoreLimitedPersonalMatch(circle, normalizedQuery, tokens)
                : scoreCircleSearchMatch(circle, normalizedQuery, tokens);
            return { circle, score, limited, nameOnly };
        })
        .filter(({ circle, score, nameOnly }) => {
            if (
                !circle._id ||
                !isCirclePublished(circle) ||
                !isDiscoverableCircle(circle, viewerIsAdmin, connectionDids) ||
                !matchesCircleTypes(circle, normalizedTypes)
            ) {
                return false;
            }

            // Personal profiles marked as artists are never listed (Tim, 2026-11-22), as in
            // Discover and on the map: artists who want a public page use an artist circle.
            if (circle.circleType === "user" && isPeerifyArtistIdentity(circle)) {
                return false;
            }

            // A limited entry, or a connection with search off, is found by name or handle only:
            // never with no search words, and never through a genre filter.
            if (nameOnly && (!normalizedQuery || normalizedGenres.length > 0 || score <= 0)) {
                return false;
            }

            return normalizedQuery ? score > 0 : true;
        })
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }

            const membersDiff = (right.circle.members || 0) - (left.circle.members || 0);
            if (membersDiff !== 0) {
                return membersDiff;
            }

            return (right.circle.createdAt?.getTime() || 0) - (left.circle.createdAt?.getTime() || 0);
        })
        .slice(0, limit);

    const maxScore = scored[0]?.score || 1;

    return scored.map(({ circle, score, limited }) => {
        if (limited) {
            return {
                ...toLimitedPersonalListItem(circle),
                metrics: { searchRank: score / maxScore, similarity: score / maxScore },
            } as WithMetric<Circle>;
        }
        // Mirrors getSwipeCircles' own mapVisible rule (circle.ts) — a personal profile that
        // hasn't opted into map visibility must never produce a map marker. map.tsx's only gate
        // for creating a marker at all is item.location.lngLat, so stripping location here (a
        // real server-side exclusion, not another client-side masking layer on top of the
        // pre-existing isSuppressedUserProfile, which only ever disguised a marker's title/image
        // without preventing one from being created) makes that impossible — while the profile
        // stays fully present, searchable, and viewable via Open; the intentionally separate
        // `searchable` gate (isDiscoverableCircle, above) is untouched. viewerIsAdmin bypasses
        // this the same way it bypasses the searchable gate, so an admin's search result for a
        // private profile still carries a location instead of a half-fix with no pin.
        const isMapVisible = viewerIsAdmin || circle.circleType !== "user" || circle.mapVisible === true;
        const exposedLocation = isMapVisible ? circle.location : undefined;
        // Crew Offers have no visibility/audience field of their own (see tourTeamOfferingSchema)
        // — gating for them is 100% application logic, normally scoped to a circle's own Crew
        // (getCrewOfferings) or the owner's own profile self-display. Search results are neither,
        // so every viewer except the profile's own owner or a platform admin gets it stripped,
        // regardless of the (unrelated) searchable/mapVisible flags this function otherwise keys
        // location visibility off of.
        const isOwnCircle = !!viewerDid && circle.did === viewerDid;
        // These results reach anonymous visitors (/api/circles/search): toPublicCircleListItem
        // allow-lists the fields, strips private metadata and redacts the location
        // (redactCircleLocationForViewer — venue addressVisibility ceiling, city level with a
        // coarse pin unless "exact" was confirmed). Owners and platform admins get everything.
        // Never in a search result, whoever is asking (platform admins and owners skip the allow-list).
        const {
            email: _email,
            officialEmail: _officialEmail,
            bookmarkedCircles: _bookmarkedCircles,
            pinnedCircles: _pinnedCircles,
            hiddenCancelledEventIds: _hiddenCancelledEventIds,
            ...searchCircle
        } = circle;
        return toPublicCircleListItem(
            {
                ...searchCircle,
                location: exposedLocation,
                tourTeamOfferings: viewerIsAdmin || isOwnCircle ? circle.tourTeamOfferings : undefined,
                metrics: {
                    searchRank: score / maxScore,
                    similarity: score / maxScore,
                },
            },
            { viewerDid, viewerIsPlatformAdmin: viewerIsAdmin },
        );
    });
};

/**
 * People search (Tim, 2026-11-23): personal profiles only, for signed-in viewers only, with the
 * same rule as searchDiscoverableCircles: "Show me in search" on (any for a superadmin), never one
 * marked as an artist; the full entry for the owner, superadmins and accepted connections, name,
 * handle and picture (found by name or handle only) for everyone else.
 */
export const searchPeople = async ({
    query = "",
    limit = 20,
    viewerDid,
}: Pick<SearchCirclesOptions, "query" | "limit" | "viewerDid">): Promise<WithMetric<Circle>[]> => {
    if (!viewerDid || !normalizeValue(query)) return [];
    return searchDiscoverableCircles({ query, limit, circleTypes: ["user"], viewerDid });
};
