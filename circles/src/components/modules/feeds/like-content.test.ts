// Run: IS_BUILD=true bun test src/components/modules/feeds/like-content.test.ts
// Likes (2026-11-22). likeContentAction checked only the view permission, which needs no verified
// profile, and skipped even that when the post's feed was missing. unlikeContentAction checked
// nothing and unlikeContent dropped the count whether or not a reaction was removed, so anyone
// signed in could push any post's or comment's count down, below zero too. Now liking needs what
// commenting needs (a verified profile included), a missing feed denies, and unlike only removes the
// caller's own reaction, never taking the count below zero.
// The database is in-memory fakes; the session is stubbed, permissions are the real isAuthorized.

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
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realNotifications = await import("@/lib/data/notifications");
mock.module("@/lib/data/notifications", () => ({
    ...realNotifications,
    notifyPostLike: async () => undefined,
    notifyCommentLike: async () => undefined,
}));

const { likeContentAction, unlikeContentAction } = await import("./actions");

const CIRCLE_ID = "64c200000000000000000001";
const FEED_ID = "64c2000000000000000000f1";
const POST_ID = "64c2000000000000000000a1";
const ORPHAN_POST_ID = "64c2000000000000000000a2"; // its feed no longer exists
const COMMENT_ID = "64c2000000000000000000c1";
const VERIFIED = "did:test:verified";
const UNVERIFIED = "did:test:unverified";
const OTHER = "did:test:other";

const user = (did: string, verified: boolean) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    circleType: "user",
    verificationStatus: verified ? "verified" : "unverified",
});

const likeCount = async (collection: "Posts" | "Comments", id: string) =>
    ((await fakeDb.col(collection).findOne({ _id: new ObjectId(id) })) as any)?.reactions?.like;
const reactionsBy = (did: string) => fakeDb.col("Reactions").docs.filter((reaction) => reaction.userDid === did);

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        // An open circle: feed.view and feed.comment are allowed for everyone (the defaults).
        Circles: [
            { _id: new ObjectId(CIRCLE_ID), handle: "band", circleType: "circle" },
            user(VERIFIED, true),
            user(UNVERIFIED, false),
            user(OTHER, true),
        ],
        Feeds: [{ _id: new ObjectId(FEED_ID), circleId: CIRCLE_ID, handle: "default" }],
        Posts: [
            { _id: new ObjectId(POST_ID), feedId: FEED_ID, createdBy: OTHER, reactions: { like: 1 } },
            { _id: new ObjectId(ORPHAN_POST_ID), feedId: "64c2000000000000000000f9", createdBy: OTHER, reactions: {} },
        ],
        Comments: [
            {
                _id: new ObjectId(COMMENT_ID),
                postId: POST_ID,
                parentCommentId: null,
                createdBy: OTHER,
                reactions: { like: 0 },
                createdAt: new Date(),
            },
        ],
        // OTHER's existing like on the post.
        Reactions: [{ contentId: POST_ID, contentType: "post", userDid: OTHER, reactionType: "like", count: 1 }],
    });
});

describe("liking", () => {
    test("a verified user can like a post", async () => {
        sessionDid = VERIFIED;
        expect((await likeContentAction(POST_ID, "post")).success).toBe(true);
        expect(await likeCount("Posts", POST_ID)).toBe(2);
        expect(reactionsBy(VERIFIED)).toHaveLength(1);
    });

    test("a verified user can like a comment", async () => {
        sessionDid = VERIFIED;
        expect((await likeContentAction(COMMENT_ID, "comment")).success).toBe(true);
        expect(await likeCount("Comments", COMMENT_ID)).toBe(1);
    });

    test("an unverified user can't like a post or a comment", async () => {
        sessionDid = UNVERIFIED;
        expect((await likeContentAction(POST_ID, "post")).success).toBe(false);
        expect((await likeContentAction(COMMENT_ID, "comment")).success).toBe(false);
        expect(await likeCount("Posts", POST_ID)).toBe(1);
        expect(await likeCount("Comments", COMMENT_ID)).toBe(0);
        expect(reactionsBy(UNVERIFIED)).toHaveLength(0);
    });

    test("a post whose feed is missing can't be liked", async () => {
        sessionDid = VERIFIED;
        expect((await likeContentAction(ORPHAN_POST_ID, "post")).success).toBe(false);
        expect(reactionsBy(VERIFIED)).toHaveLength(0);
    });

    test("signed out: nothing happens", async () => {
        expect((await likeContentAction(POST_ID, "post")).success).toBe(false);
        expect(await likeCount("Posts", POST_ID)).toBe(1);
    });
});

describe("unliking", () => {
    test("removes the user's own like and lowers the count by one", async () => {
        sessionDid = VERIFIED;
        await likeContentAction(POST_ID, "post");
        expect((await unlikeContentAction(POST_ID, "post")).success).toBe(true);
        expect(await likeCount("Posts", POST_ID)).toBe(1);
        expect(reactionsBy(VERIFIED)).toHaveLength(0);
        expect(reactionsBy(OTHER)).toHaveLength(1);
    });

    test("without a like of your own, nothing changes, however often it's called", async () => {
        sessionDid = VERIFIED;
        for (let i = 0; i < 3; i++) {
            expect((await unlikeContentAction(POST_ID, "post")).success).toBe(false);
        }
        expect(await likeCount("Posts", POST_ID)).toBe(1);
        expect(reactionsBy(OTHER)).toHaveLength(1);
    });

    test("an unverified user hammering unlike can't move the count either", async () => {
        sessionDid = UNVERIFIED;
        await unlikeContentAction(POST_ID, "post");
        await unlikeContentAction(COMMENT_ID, "comment");
        expect(await likeCount("Posts", POST_ID)).toBe(1);
        expect(await likeCount("Comments", COMMENT_ID)).toBe(0);
    });

    test("the count never goes below zero, even if it was already out of step", async () => {
        // A reaction exists but the stored count is 0 (as left by the old bug).
        await fakeDb.col("Reactions").insertOne({
            contentId: COMMENT_ID,
            contentType: "comment",
            userDid: VERIFIED,
            reactionType: "like",
            count: 1,
        });
        sessionDid = VERIFIED;
        expect((await unlikeContentAction(COMMENT_ID, "comment")).success).toBe(true);
        expect(await likeCount("Comments", COMMENT_ID)).toBe(0);
        expect(reactionsBy(VERIFIED)).toHaveLength(0);
    });

    test("signed out: nothing happens", async () => {
        expect((await unlikeContentAction(POST_ID, "post")).success).toBe(false);
        expect(await likeCount("Posts", POST_ID)).toBe(1);
    });
});

describe("only likes", () => {
    test("another reaction type is refused, and no counter is created", async () => {
        sessionDid = VERIFIED;
        for (const reactionType of ["love", "like.extra", "$set", ""]) {
            expect((await likeContentAction(POST_ID, "post", reactionType)).success).toBe(false);
        }
        const post = (await fakeDb.col("Posts").findOne({ _id: new ObjectId(POST_ID) })) as any;
        expect(post.reactions).toEqual({ like: 1 });
        expect(reactionsBy(VERIFIED)).toHaveLength(0);
    });

    test("unlike with another reaction type is refused", async () => {
        sessionDid = VERIFIED;
        await likeContentAction(POST_ID, "post");
        expect((await unlikeContentAction(POST_ID, "post", "love")).success).toBe(false);
        expect(reactionsBy(VERIFIED)).toHaveLength(1);
        expect(await likeCount("Posts", POST_ID)).toBe(2);
    });

    test("a content type other than post or comment is refused", async () => {
        sessionDid = VERIFIED;
        expect((await likeContentAction(POST_ID, "track" as any)).success).toBe(false);
        expect((await unlikeContentAction(POST_ID, "track" as any)).success).toBe(false);
        expect(reactionsBy(VERIFIED)).toHaveLength(0);
    });
});
