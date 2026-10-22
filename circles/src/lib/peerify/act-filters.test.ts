// Run: bun test src/lib/peerify/act-filters.test.ts — pure, no database.
// Act format / "What you do" (2026-10-22): the identityType fallback, the normaliser, the public
// allow-list, and that the Mongo query (buildActFilterMongoQuery) picks exactly the circles the
// client predicate (matchesActFilters) does, over one shared set of circles.

import { describe, expect, test } from "bun:test";
import type { Circle } from "@/models/models";
import { matchesFilter } from "@/lib/testing/fake-collection";
import { toPublicCircleListItem } from "@/lib/utils/public-circle";
import {
    buildActFilterMongoQuery,
    getIdentityTypeForActFormat,
    getPeerifyActFormat,
    getPeerifyArtistTypeBadges,
    matchesActFilters,
    normalizePeerifyArtistProfile,
    PEERIFY_ACT_FORMATS,
    PEERIFY_ACT_OFFERS,
    type PeerifyActFilters,
} from "./artist-profile";

const circle = (id: string, peerify?: Record<string, unknown>, extra: Partial<Circle> = {}): Circle =>
    ({
        _id: id,
        did: `did:test:${id}`,
        handle: id,
        name: id,
        circleType: "circle",
        ...(peerify ? { metadata: { peerify } } : {}),
        ...extra,
    }) as Circle;

const managed = (identityType: string, artistProfile?: Record<string, unknown>) => ({
    managedIdentity: true,
    identityType,
    ...(artistProfile ? { artistProfile } : {}),
});

const CIRCLES: Circle[] = [
    circle("pilot-default", managed("artist")),
    circle("band-default", managed("band")),
    circle("dj-default", managed("dj")),
    circle("producer-default", managed("producer")),
    circle("chosen-duo", managed("artist", { actFormat: "duo", actOffers: ["covers_tributes", "session_musician"] })),
    circle("chosen-ensemble", managed("band", { actFormat: "ensemble" })),
    // Chosen format wins over identityType.
    circle("chosen-solo-on-band", managed("band", { actFormat: "solo", actOffers: ["lessons_workshops"] })),
    circle("bad-format", managed("band", { actFormat: "orchestra", actOffers: ["nonsense", "dj_sets"] })),
    circle("intent-only", { intent: "artist" }),
    circle("intent-venue-type", { intent: "artist", identityType: "venue" }),
    // Not artists: always pass, whatever the filter.
    circle("venue", managed("venue")),
    circle("unmanaged-band", { identityType: "band" }),
    circle("plain"),
    circle("person", undefined, { circleType: "user" }),
];

const NON_ARTISTS = ["venue", "unmanaged-band", "plain", "person"];

const clientIds = (filters: PeerifyActFilters) =>
    CIRCLES.filter((c) => matchesActFilters(c, filters)).map((c) => c._id);

const mongoIds = (filters: PeerifyActFilters) => {
    const query = buildActFilterMongoQuery(filters);
    return CIRCLES.filter((c) => !query || matchesFilter(c as Record<string, unknown>, query)).map((c) => c._id);
};

describe("getPeerifyActFormat", () => {
    test("falls back to identityType, chosen format wins, invalid ignored", () => {
        const formats = Object.fromEntries(CIRCLES.map((c) => [c._id, getPeerifyActFormat(c) ?? null]));
        expect(formats).toEqual({
            "pilot-default": "solo",
            "band-default": "band",
            "dj-default": "dj_producer",
            "producer-default": "dj_producer",
            "chosen-duo": "duo",
            "chosen-ensemble": "ensemble",
            "chosen-solo-on-band": "solo",
            "bad-format": "band",
            "intent-only": "solo",
            "intent-venue-type": "solo",
            venue: null,
            "unmanaged-band": "band",
            plain: null,
            person: null,
        });
    });

    test("identityType sync for a chosen format", () => {
        expect(getIdentityTypeForActFormat("solo")).toBe("artist");
        expect(getIdentityTypeForActFormat("duo")).toBe("artist");
        expect(getIdentityTypeForActFormat("band")).toBe("band");
        expect(getIdentityTypeForActFormat("ensemble")).toBe("band");
        expect(getIdentityTypeForActFormat("dj_producer", "artist")).toBe("dj");
        expect(getIdentityTypeForActFormat("dj_producer", "producer")).toBe("producer");
    });
});

describe("normalizePeerifyArtistProfile", () => {
    test("keeps valid act fields, drops unknown ones, orders offers by option order", () => {
        const profile = normalizePeerifyArtistProfile({
            actFormat: "duo",
            actOffers: ["session_musician", "bogus", "original_music", "session_musician"],
        });
        expect(profile.actFormat).toBe("duo");
        expect(profile.actOffers).toEqual(["original_music", "session_musician"]);
    });

    test("slugs removed from the list (2026-10-22) are dropped on read", () => {
        const profile = normalizePeerifyArtistProfile({
            actOffers: ["songwriting", "production_engineering", "comedy_spoken_word", "comedy", "lessons_workshops"],
        });
        expect(profile.actOffers).toEqual(["lessons_workshops", "comedy"]);
        const c = circle("old", managed("artist", { actOffers: ["songwriting", "spoken_word"] }));
        expect(getPeerifyArtistTypeBadges(c)).toEqual(["Spoken word"]);
        expect(matchesActFilters(c, { actOffers: ["songwriting"] })).toBe(true); // unknown filter value = no filter
        expect(matchesActFilters(c, { actOffers: ["comedy"] })).toBe(false);
    });

    test("an invalid or missing format is left unset, so the fallback applies", () => {
        expect("actFormat" in normalizePeerifyArtistProfile({ actFormat: "orchestra" })).toBe(false);
        expect(normalizePeerifyArtistProfile({}).actOffers).toEqual([]);
    });
});

describe("badges", () => {
    test("act format, then What you do, then the describe-your-act tags", () => {
        const c = circle(
            "b",
            managed("artist", {
                actFormat: "duo",
                actOffers: ["session_musician", "covers_tributes", "composing_film_games_theatre"],
                artistTypes: ["Band"],
                artistTypeOtherLabels: ["Comedian"],
            }),
        );
        expect(getPeerifyArtistTypeBadges(c)).toEqual(["Duo", "Covers and tributes", "Session musician", "Composing", "Comedian"]);
        // No format chosen: no format badge, even though the filter treats it as a band.
        expect(getPeerifyArtistTypeBadges(CIRCLES[1])).toEqual([]);
        expect(getPeerifyArtistTypeBadges(CIRCLES[0])).toEqual([]);
    });
});

describe("matchesActFilters and buildActFilterMongoQuery agree", () => {
    const cases: [string, PeerifyActFilters, string[]][] = [
        ["no filter", {}, CIRCLES.map((c) => c._id as string)],
        ["solo", { actFormats: ["solo"] }, ["pilot-default", "chosen-solo-on-band", "intent-only", "intent-venue-type"]],
        ["band", { actFormats: ["band"] }, ["band-default", "bad-format"]],
        ["dj/producer", { actFormats: ["dj_producer"] }, ["dj-default", "producer-default"]],
        ["duo or ensemble", { actFormats: ["duo", "ensemble"] }, ["chosen-duo", "chosen-ensemble"]],
        ["covers", { actOffers: ["covers_tributes"] }, ["chosen-duo"]],
        ["dj sets (from a profile with junk values too)", { actOffers: ["dj_sets"] }, ["bad-format"]],
        ["covers or lessons", { actOffers: ["covers_tributes", "lessons_workshops"] }, ["chosen-duo", "chosen-solo-on-band"]],
        ["solo AND lessons", { actFormats: ["solo"], actOffers: ["lessons_workshops"] }, ["chosen-solo-on-band"]],
        ["duo AND lessons", { actFormats: ["duo"], actOffers: ["lessons_workshops"] }, []],
        ["unknown values only = no filter", { actFormats: ["orchestra"], actOffers: ["bogus"] }, CIRCLES.map((c) => c._id as string)],
    ];

    for (const [name, filters, expectedArtists] of cases) {
        test(name, () => {
            const client = clientIds(filters);
            const expected = expectedArtists.length === CIRCLES.length ? expectedArtists : [...expectedArtists, ...NON_ARTISTS];
            expect(client.sort()).toEqual([...expected].sort());
            expect(mongoIds(filters).sort()).toEqual(client.sort());
        });
    }

    test("every single format and offer: Mongo and client agree", () => {
        for (const actFormat of PEERIFY_ACT_FORMATS) {
            expect(mongoIds({ actFormats: [actFormat] }).sort()).toEqual(clientIds({ actFormats: [actFormat] }).sort());
        }
        for (const actOffer of PEERIFY_ACT_OFFERS) {
            expect(mongoIds({ actOffers: [actOffer] }).sort()).toEqual(clientIds({ actOffers: [actOffer] }).sort());
        }
    });

    test("no filter builds no query", () => {
        expect(buildActFilterMongoQuery({})).toBeUndefined();
        expect(buildActFilterMongoQuery({ actFormats: [], actOffers: [] })).toBeUndefined();
    });
});

describe("public allow-list", () => {
    test("a logged-out viewer gets actFormat and actOffers", () => {
        const c = circle(
            "pub",
            managed("artist", { actFormat: "duo", actOffers: ["spoken_word"], lookingFor: ["Fans"] }),
        );
        const publicCircle = toPublicCircleListItem(c, { viewerDid: undefined, viewerIsPlatformAdmin: false });
        const artistProfile = (publicCircle.metadata as any)?.peerify?.artistProfile;
        expect(artistProfile.actFormat).toBe("duo");
        expect(artistProfile.actOffers).toEqual(["spoken_word"]);
        // Still private.
        expect(artistProfile.lookingFor).toBeUndefined();
        // So the client-side filter works for that viewer too.
        expect(matchesActFilters(publicCircle, { actFormats: ["duo"], actOffers: ["spoken_word"] })).toBe(true);
    });
});
