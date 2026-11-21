// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/draft-lineup.test.ts"
// L5 (draft artist profiles, 2026-11-21): the artist picker leaves drafts out, but
// addArtistToEvent took any artist circle id, and a lineup is public: an event editor who knew a
// draft's _id put its name and picture on the event page. addArtistToEvent now refuses an
// unpublished artist, and getEventArtistsAction leaves one out (e.g. unpublished after being
// added) for viewers who couldn't open its page. Event reads/writes are stubbed; circles are
// in-memory fakes.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const HOST_ID = "64a000000000000000000b01";
const DRAFT_ID = "64a000000000000000000b02";
const LIVE_ID = "64a000000000000000000b03";
const EVENT_ID = "64a0000000000000000000b9";
const EDITOR = "did:test:editor";
const DRAFT_OWNER = "did:test:draft-owner";
const STRANGER = "did:test:stranger";

let sessionDid: string | undefined;
let lineup: string[] = [];
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async () => true,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const theEvent = () => ({
    _id: EVENT_ID,
    circleId: HOST_ID,
    title: "Show",
    stage: "open",
    createdBy: EDITOR,
    additionalArtistCircleIds: [...lineup],
});
const realEvent = await import("@/lib/data/event");
mock.module("@/lib/data/event", () => ({
    ...realEvent,
    getEventById: async () => theEvent(),
    getPublicEventByIdForCircle: async () => theEvent(),
    updateEvent: async (_id: string, update: { additionalArtistCircleIds?: string[] }) => {
        if (update.additionalArtistCircleIds) lineup = update.additionalArtistCircleIds;
        return true;
    },
}));
const realEventNotifications = await import("@/lib/data/eventNotifications");
mock.module("@/lib/data/eventNotifications", () => ({
    ...realEventNotifications,
    notifyAddedAsEventArtist: async () => undefined,
}));
const realUser = await import("@/lib/data/user");
mock.module("@/lib/data/user", () => ({ ...realUser, getUserByDid: async (did: string) => ({ did, name: did }) }));

const { addArtistToEvent, getEventArtistsAction } = await import("./actions");

const artist = (id: string, handle: string, name: string, publishStatus: string) => ({
    _id: new ObjectId(id),
    did: `did:test:${handle}`,
    handle,
    name,
    circleType: "circle",
    createdBy: DRAFT_OWNER,
    publishStatus,
    metadata: { peerify: { managedIdentity: true, identityType: "artist" } },
});

beforeEach(() => {
    sessionDid = EDITOR;
    lineup = [];
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(HOST_ID),
                handle: "venue",
                name: "Venue",
                circleType: "circle",
                publishStatus: "published",
            },
            artist(DRAFT_ID, "draft-artist", "SECRET DRAFT ARTIST", "draft"),
            artist(LIVE_ID, "live-artist", "Live Artist", "published"),
        ],
    });
});

const lineupText = async () => JSON.stringify(await getEventArtistsAction("venue", EVENT_ID));

describe("adding an artist to a lineup", () => {
    test("a draft's id is refused like a non-artist id, and the event is unchanged", async () => {
        const result = await addArtistToEvent("venue", EVENT_ID, DRAFT_ID);
        expect(result).toEqual({ success: false, message: "Selected circle is not an artist profile" });
        expect(lineup).toEqual([]);
    });

    test("a published artist is added as before", async () => {
        expect((await addArtistToEvent("venue", EVENT_ID, LIVE_ID)).success).toBe(true);
        expect(lineup).toEqual([LIVE_ID]);
    });
});

describe("a lineup that already holds an unpublished artist", () => {
    beforeEach(() => {
        lineup = [DRAFT_ID, LIVE_ID];
    });

    for (const [who, did] of [
        ["signed out", undefined],
        ["a signed-in stranger", STRANGER],
    ] as const) {
        test(`${who}: the draft is left out, the published artist stays`, async () => {
            sessionDid = did;
            const text = await lineupText();
            expect(text).not.toContain("SECRET DRAFT ARTIST");
            expect(text).toContain("Live Artist");
        });
    }

    test("the draft's own creator still sees it", async () => {
        sessionDid = DRAFT_OWNER;
        expect(await lineupText()).toContain("SECRET DRAFT ARTIST");
    });
});
