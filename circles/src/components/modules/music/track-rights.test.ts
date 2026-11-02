// Run: IS_BUILD=true bun test src/components/modules/music/track-rights.test.ts
// Track rights wording (2026-10-27): uploadTrackAction stores which rights statement was ticked
// (version key and full text, lib/peerify/track-rights.ts) and refuses a form showing any other
// wording. Session, permission check, storage, ffmpeg and the track store are stubbed, so nothing
// is uploaded or transcoded.

import { beforeEach, describe, expect, mock, test } from "bun:test";

const OWNER = "did:test:owner";
const CIRCLE_ID = "aaaaaaaaaaaaaaaaaaaaaaa1";
let sessionDid: string | undefined = OWNER;
const created: Record<string, unknown>[] = [];
const stored: string[] = [];

const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined) => did === OWNER,
}));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCircleById: async (id: string) => ({ _id: id, handle: "artist-1" }),
}));
const realStorage = await import("@/lib/data/storage");
mock.module("@/lib/data/storage", () => ({
    ...realStorage,
    putPrivateObject: async (key: string) => {
        stored.push(key);
    },
}));
const realTrack = await import("@/lib/data/track");
mock.module("@/lib/data/track", () => ({
    ...realTrack,
    getTracksByCircleId: async () => [],
    createTrack: async (track: Record<string, unknown>) => {
        created.push(track);
        return { ...track, _id: "track-1" };
    },
}));
mock.module("@/lib/audio/ffmpeg", () => ({
    generateMp3Preview: async () => ({ buffer: Buffer.from("preview"), durationSec: 3 }),
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { uploadTrackAction } = await import("./actions");
const {
    CURRENT_TRACK_RIGHTS_TEXT,
    CURRENT_TRACK_RIGHTS_VERSION,
    TRACK_RIGHTS_ATTESTATIONS,
    TRACK_RIGHTS_STALE_MESSAGE,
} = await import("@/lib/peerify/track-rights");

const form = (overrides: Record<string, string | null> = {}) => {
    const entries: Record<string, string | null> = {
        title: "Song",
        circleId: CIRCLE_ID,
        rightsConfirmed: "true",
        rightsVersion: CURRENT_TRACK_RIGHTS_VERSION,
        ...overrides,
    };
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) {
        if (value !== null) data.append(key, value);
    }
    data.append("audio", new File([new Uint8Array(100)], "song.mp3", { type: "audio/mpeg" }));
    return data;
};

beforeEach(() => {
    sessionDid = OWNER;
    created.length = 0;
    stored.length = 0;
});

describe("track rights wording", () => {
    test("the current wording is the 2026-10-27 one; the original is kept unchanged", () => {
        expect(CURRENT_TRACK_RIGHTS_VERSION).toBe("2026-10-27");
        expect(CURRENT_TRACK_RIGHTS_TEXT).toBe(
            "I own or control the rights to this audio and/or have permission to upload it.",
        );
        expect(TRACK_RIGHTS_ATTESTATIONS["2026-06-26"]).toBe(
            "I own or control the rights to this audio and have permission to upload it.",
        );
    });
});

describe("uploadTrackAction rights attestation", () => {
    test("stores the version and full text with the track", async () => {
        const result = await uploadTrackAction(form());
        expect(result.success).toBe(true);
        expect(created).toHaveLength(1);
        expect(created[0].rightsConfirmed).toBe(true);
        expect(created[0].rightsConfirmedAt instanceof Date).toBe(true);
        expect(created[0].rightsAttestationVersion).toBe("2026-10-27");
        expect(created[0].rightsAttestationText).toBe(CURRENT_TRACK_RIGHTS_TEXT);
    });

    test("an old or missing version is refused before anything is stored", async () => {
        for (const rightsVersion of ["2026-06-26", "bogus", null]) {
            const result = await uploadTrackAction(form({ rightsVersion }));
            expect(result.success).toBe(false);
            expect(result.message).toBe(TRACK_RIGHTS_STALE_MESSAGE);
        }
        expect(created).toHaveLength(0);
        expect(stored).toHaveLength(0);
    });

    test("an unticked box is still refused", async () => {
        const result = await uploadTrackAction(form({ rightsConfirmed: null }));
        expect(result.success).toBe(false);
        expect(result.message).toContain("You must confirm you own or control the rights");
        expect(created).toHaveLength(0);
        expect(stored).toHaveLength(0);
    });

    test("a non-editor is refused", async () => {
        sessionDid = "did:test:stranger";
        const result = await uploadTrackAction(form());
        expect(result.success).toBe(false);
        expect(created).toHaveLength(0);
    });
});
