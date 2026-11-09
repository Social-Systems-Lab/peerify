// Run: IS_BUILD=true bun test src/lib/data/comment-author-not-stored.test.ts
// Comments used to be stored with `author`: the commenter's (or acting circle's) whole circle
// document (location, metadata, members, offers, ...), attached by createCommentAction and
// createTrackCommentAction for their response. Nothing reads it back (readers look the author up
// fresh), so the stored copy was only stale personal data. Since 2026-11-09 it isn't stored; the
// caller still gets it back. The database is in-memory fakes (testing/fake-db.ts).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    isAuthorized: async () => true,
    getAuthenticatedUserDid: async () => undefined,
}));

const { createComment } = await import("./feed");
const { createTrackComment } = await import("./track");

const STREET = "Canary Street 7";
const author = {
    _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    did: "did:test:commenter",
    name: "Commenter",
    handle: "commenter",
    location: { street: STREET, lngLat: { lng: 18.07, lat: 59.33 } },
    tourTeamOfferings: [{ photos: [{ url: "/storage/aaaaaaaaaaaaaaaaaaaaaaaa/offer-photo-1.jpg" }] }],
};

const POST_ID = new ObjectId().toString();
const TRACK_ID = new ObjectId().toString();

const base = {
    parentCommentId: null,
    content: "a comment",
    createdBy: "did:test:commenter",
    createdAt: new Date("2026-11-09T12:00:00Z"),
    reactions: {},
    replies: 0,
};

const storedComments = async () => fakeDb.col("Comments").docs as Record<string, unknown>[];

describe("comments are stored without the author copy", () => {
    beforeEach(() => {
        fakeDb.reset({
            Posts: [{ _id: new ObjectId(POST_ID), comments: 0 }],
            Tracks: [{ _id: new ObjectId(TRACK_ID), commentCount: 0 }],
        });
    });

    test("createComment (post comments)", async () => {
        const returned = await createComment({ ...base, postId: POST_ID, author } as any);
        const stored = await storedComments();
        expect(stored.length).toBe(1);
        expect("author" in stored[0]).toBe(false);
        expect(JSON.stringify(stored[0])).not.toContain(STREET);
        expect(JSON.stringify(stored[0])).not.toContain("offer-photo");
        // Everything else is stored as before.
        expect(stored[0].content).toBe("a comment");
        expect(stored[0].postId).toBe(POST_ID);
        expect(stored[0].createdBy).toBe("did:test:commenter");
        // The caller (notifications, the response) still gets the author and the new id.
        expect((returned as any).author).toEqual(author);
        expect(typeof returned._id).toBe("string");
        expect(String(stored[0]._id)).toBe(returned._id);
    });

    test("createTrackComment (song comments)", async () => {
        const returned = await createTrackComment({ ...base, trackId: TRACK_ID, author } as any);
        const stored = await storedComments();
        expect(stored.length).toBe(1);
        expect("author" in stored[0]).toBe(false);
        expect(JSON.stringify(stored[0])).not.toContain(STREET);
        expect(stored[0].content).toBe("a comment");
        expect(stored[0].trackId).toBe(TRACK_ID);
        expect((returned as any).author).toEqual(author);
        expect(String(stored[0]._id)).toBe(returned._id);
    });
});
