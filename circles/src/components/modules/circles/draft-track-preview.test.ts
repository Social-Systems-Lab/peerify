// Run: IS_BUILD=true bun test src/components/modules/circles/draft-track-preview.test.ts
// L4 (draft artist profiles, 2026-11-21): getTracksForCirclePreviewAction (the map pin's music
// preview) took any circle id. Logged out, every managed identity counted as public music; signed
// in, music.view's default includes "everyone". So a draft artist's tracks were listed and given a
// signed stream URL by id. An unpublished circle now gives [] unless the viewer may open it.
// Tracks and signing are stubbed; the database is in-memory fakes.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async () => true,
}));
const realTrack = await import("@/lib/data/track");
mock.module("@/lib/data/track", () => ({
    ...realTrack,
    getTracksByCircleId: async () => [{ _id: "t1", title: "SECRET DRAFT TRACK", fileUrl: "x", duration: 1 }],
}));
const realAudio = await import("@/lib/audio/audio-token");
mock.module("@/lib/audio/audio-token", () => ({ ...realAudio, signAudioToken: async () => "signed" }));

const { getTracksForCirclePreviewAction } = await import("./map-explorer-actions");

const DRAFT_ID = "64a000000000000000000a01";
const OWNER = "did:test:owner";
const STRANGER = "did:test:stranger";

const seed = (publishStatus?: string) =>
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(DRAFT_ID),
                did: "did:test:artist",
                handle: "draft-artist",
                name: "Draft Artist",
                circleType: "circle",
                createdBy: OWNER,
                metadata: { peerify: { managedIdentity: true, identityType: "artist" } },
                ...(publishStatus ? { publishStatus } : {}),
            },
        ],
    });

beforeEach(() => {
    sessionDid = undefined;
    seed("draft");
});

describe("map preview tracks", () => {
    for (const [who, did] of [
        ["signed out", undefined],
        ["a signed-in stranger", STRANGER],
    ] as const) {
        test(`draft, ${who}: nothing`, async () => {
            sessionDid = did;
            expect(await getTracksForCirclePreviewAction(DRAFT_ID)).toEqual([]);
        });
    }

    test("draft, its creator: the tracks", async () => {
        sessionDid = OWNER;
        expect((await getTracksForCirclePreviewAction(DRAFT_ID)).length).toBe(1);
    });

    for (const status of ["published", undefined]) {
        test(`publishStatus ${status ?? "missing"}: unchanged, signed out and signed in`, async () => {
            seed(status);
            expect((await getTracksForCirclePreviewAction(DRAFT_ID)).length).toBe(1);
            sessionDid = STRANGER;
            expect((await getTracksForCirclePreviewAction(DRAFT_ID)).length).toBe(1);
        });
    }
});
