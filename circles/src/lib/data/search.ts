import { Circle, CircleType, WithMetric } from "@/models/models";
import { Circles } from "./db";
import { getPublishedCircleQuery, isCirclePublished, SAFE_CIRCLE_PROJECTION } from "./circle";
import { redactLocationForViewer } from "../utils";

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
    viewerDid?: string;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
const isDiscoverableCircle = (circle: Circle, viewerIsAdmin: boolean) =>
    viewerIsAdmin || circle.circleType !== "user" || Boolean(circle.searchable);

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
) => {
    const discoverableTypeClauses: Record<string, unknown>[] = [];
    const nonUserTypes = circleTypes.filter((type) => type !== "user");

    if (nonUserTypes.length > 0) {
        discoverableTypeClauses.push({ circleType: { $in: nonUserTypes } });
    }

    if (circleTypes.includes("user")) {
        discoverableTypeClauses.push(
            viewerIsAdmin ? { circleType: "user" } : { $and: [{ circleType: "user" }, { searchable: true }] },
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

    if (query) {
        const tokens = [query, ...tokenizeQuery(query)].filter(Boolean);
        const regexes = tokens.map((token) => new RegExp(escapeRegex(token), "i"));
        clauses.push({
            $or: regexes.flatMap((regex) => SEARCHABLE_FIELDS.map((field) => ({ [field]: regex }))),
        });
    }

    return clauses.length === 1 ? clauses[0] : { $and: clauses };
};

export const searchDiscoverableCircles = async ({
    query = "",
    limit = 20,
    circleTypes = SEARCHABLE_TYPES,
    primaryGenres = [],
    viewerDid,
}: SearchCirclesOptions): Promise<WithMetric<Circle>[]> => {
    // Trusted lookup, not a caller-supplied flag — see isDiscoverableCircle's comment above and
    // getSwipeCircles in circle.ts, which resolves its own admin bypass the same way.
    let viewerIsAdmin = false;
    if (viewerDid) {
        const viewer = await Circles.findOne({ did: viewerDid }, { projection: { isAdmin: 1 } });
        viewerIsAdmin = viewer?.isAdmin === true;
    }

    const normalizedQuery = normalizeValue(query);
    const normalizedTypes = circleTypes.length > 0 ? circleTypes : SEARCHABLE_TYPES;
    const normalizedGenres = primaryGenres.filter(Boolean);
    const candidateLimit = Math.max(limit * 6, 120);
    const candidateQuery = buildCandidateQuery(normalizedQuery, normalizedTypes, normalizedGenres, viewerIsAdmin);

    const circles = (await Circles.find(candidateQuery, { projection: SAFE_CIRCLE_PROJECTION }).limit(candidateLimit).toArray()) as Circle[];
    const tokens = tokenizeQuery(normalizedQuery);

    const scored = circles
        .map((circle) => {
            if (circle._id) {
                circle._id = circle._id.toString();
            }

            const score = scoreCircleSearchMatch(circle, normalizedQuery, tokens);
            return { circle, score };
        })
        .filter(({ circle, score }) => {
            if (
                !circle._id ||
                !isCirclePublished(circle) ||
                !isDiscoverableCircle(circle, viewerIsAdmin) ||
                !matchesCircleTypes(circle, normalizedTypes)
            ) {
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

    return scored.map(({ circle, score }) => {
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
        return {
            ...circle,
            location: redactLocationForViewer(exposedLocation, circle.did, { viewerDid, viewerIsAdmin }),
            tourTeamOfferings: viewerIsAdmin || isOwnCircle ? circle.tourTeamOfferings : undefined,
            metrics: {
                searchRank: score / maxScore,
                similarity: score / maxScore,
            },
        };
    });
};
