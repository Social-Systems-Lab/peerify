// Run: IS_BUILD=true bun test src/app/act-format-save.test.ts
// Act format (2026-10-22): onboarding A2 (saveArtistActFormatAction) and Settings › About
// (saveAbout) store artistProfile.actFormat and keep identityType in step, so the default hero,
// avatar and label follow the chosen format. The database is in-memory fakes
// (testing/fake-db.ts) and the session/permission checks are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const OWNER = "did:test:owner";
let sessionDid: string | undefined = OWNER;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined) => did === OWNER,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
// updateCircle stores what the action hands it, minus undefined fields (the real one writes
// those as unset/null, which the fake refuses); everything the actions decide stays real.
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    updateCircle: async (update: Record<string, unknown>) => {
        const { _id, ...rest } = update;
        const set = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
        await fakeDb.col("Circles").updateOne({ _id: new ObjectId(String(_id)) }, { $set: set });
        return update;
    },
}));

const { saveArtistActFormatAction } = await import("./onboarding/pilot/actions");
const { saveAbout } = await import("./circles/[handle]/settings/about/actions");
const { getDefaultHeroUrl, DEFAULT_HERO_URLS } = await import("@/lib/default-heroes");
const { normalizePeerifyArtistProfile } = await import("@/lib/peerify/artist-profile");

const ARTIST_ID = "aaaaaaaaaaaaaaaaaaaaaaa1";
const artistCircle = (identityType: string, artistProfile: Record<string, unknown> = {}) => ({
    _id: new ObjectId(ARTIST_ID),
    did: "did:test:artist-1",
    handle: "artist-1",
    name: "Artist One",
    circleType: "circle",
    createdBy: OWNER,
    metadata: { peerify: { managedIdentity: true, identityType, artistProfile } },
});

const stored = async () => (await fakeDb.col("Circles").findOne({ _id: new ObjectId(ARTIST_ID) })) as any;

beforeEach(() => {
    sessionDid = OWNER;
});

describe("saveArtistActFormatAction (onboarding A2)", () => {
    const cases: [string, string, string, string][] = [
        // [format, identityType before, identityType after, hero]
        ["solo", "band", "artist", DEFAULT_HERO_URLS.solo],
        ["duo", "artist", "artist", DEFAULT_HERO_URLS.solo],
        ["band", "artist", "band", DEFAULT_HERO_URLS.band],
        ["ensemble", "artist", "band", DEFAULT_HERO_URLS.band],
        ["dj_producer", "artist", "dj", DEFAULT_HERO_URLS.dj],
        ["dj_producer", "producer", "producer", DEFAULT_HERO_URLS.dj],
    ];

    for (const [actFormat, before, after, hero] of cases) {
        test(`${actFormat} on a ${before}: identityType ${after}`, async () => {
            fakeDb.reset({ Circles: [artistCircle(before, { actOffers: ["session_musician"], primaryGenres: ["Folk"] })] });
            const result = await saveArtistActFormatAction(ARTIST_ID, actFormat as any);
            expect(result.success).toBe(true);
            const circle = await stored();
            expect(circle.metadata.peerify.identityType).toBe(after);
            expect(circle.metadata.peerify.artistProfile.actFormat).toBe(actFormat);
            // The rest of the profile is kept.
            expect(circle.metadata.peerify.artistProfile.actOffers).toEqual(["session_musician"]);
            expect(circle.metadata.peerify.artistProfile.primaryGenres).toEqual(["Folk"]);
            expect(getDefaultHeroUrl(circle)).toBe(hero);
        });
    }

    test("refuses an unknown format and a stranger", async () => {
        fakeDb.reset({ Circles: [artistCircle("artist")] });
        expect((await saveArtistActFormatAction(ARTIST_ID, "orchestra" as any)).success).toBe(false);
        sessionDid = "did:test:stranger";
        expect((await saveArtistActFormatAction(ARTIST_ID, "band")).success).toBe(false);
        expect((await stored()).metadata.peerify.identityType).toBe("artist");
    });
});

describe("saveAbout (Settings › About)", () => {
    const save = (artistProfile: Record<string, unknown>) =>
        saveAbout({
            _id: ARTIST_ID,
            name: "Artist One",
            handle: "artist-1",
            peerifyArtistProfile: normalizePeerifyArtistProfile(artistProfile),
        } as any);

    test("stores act format and What you do, and syncs identityType", async () => {
        fakeDb.reset({ Circles: [artistCircle("artist", { artistTypes: ["Solo artist"] })] });
        const result = await save({
            actFormat: "ensemble",
            actOffers: ["lessons_workshops", "covers_tributes"],
            artistTypes: ["Solo artist"],
            artistTypeOtherLabels: ["Choir"],
        });
        expect(result.success).toBe(true);
        const circle = await stored();
        expect(circle.metadata.peerify.identityType).toBe("band");
        expect(circle.metadata.peerify.artistProfile.actFormat).toBe("ensemble");
        expect(circle.metadata.peerify.artistProfile.actOffers).toEqual(["covers_tributes", "lessons_workshops"]);
        expect(circle.metadata.peerify.artistProfile.artistTypeOtherLabels).toEqual(["Choir"]);
        // Legacy field left as stored.
        expect(circle.metadata.peerify.artistProfile.artistTypes).toEqual(["Solo artist"]);
    });

    test("no act format chosen: identityType is left alone", async () => {
        fakeDb.reset({ Circles: [artistCircle("dj")] });
        expect((await save({ actOffers: ["dj_sets"] })).success).toBe(true);
        const circle = await stored();
        expect(circle.metadata.peerify.identityType).toBe("dj");
        expect(circle.metadata.peerify.artistProfile.actFormat).toBeUndefined();
        expect(circle.metadata.peerify.artistProfile.actOffers).toEqual(["dj_sets"]);
    });

    test("a venue's identityType never changes", async () => {
        fakeDb.reset({
            Circles: [
                {
                    ...artistCircle("venue"),
                    metadata: { peerify: { managedIdentity: true, identityType: "venue", venueProfile: {} } },
                },
            ],
        });
        await saveAbout({
            _id: ARTIST_ID,
            name: "Venue",
            handle: "artist-1",
            peerifyArtistProfile: normalizePeerifyArtistProfile({ actFormat: "band" }),
            peerifyVenueProfile: {},
        } as any);
        expect((await stored()).metadata.peerify.identityType).toBe("venue");
    });
});
