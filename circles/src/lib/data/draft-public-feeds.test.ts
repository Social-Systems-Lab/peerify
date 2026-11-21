// Run: IS_BUILD=true bun test src/lib/data/draft-public-feeds.test.ts
// L7 (draft artist profiles, 2026-11-21): getPublicFeeds (the global feed, /foryou) returned every
// "everyone" feed, including the default feed createCircle gives a draft, so a post made in a
// draft reached everyone. Feeds of draft or pending circles are now left out; published circles
// and circles with no publishStatus are unchanged, and a draft's own members still reach its feed
// through getAccessibleFeedIds' membership branch. The database is in-memory fakes.

import { beforeEach, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const { getPublicFeeds } = await import("./feed");

const ids = {
    draft: "64a000000000000000000c01",
    pending: "64a000000000000000000c02",
    published: "64a000000000000000000c03",
    legacy: "64a000000000000000000c04",
};
const feed = (id: string, circleId: string, userGroups = ["admins", "moderators", "members", "everyone"]) => ({
    _id: id,
    handle: "default",
    circleId,
    userGroups,
});

beforeEach(() => {
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(ids.draft), circleType: "circle", publishStatus: "draft" },
            { _id: new ObjectId(ids.pending), circleType: "circle", publishStatus: "pending_verification" },
            { _id: new ObjectId(ids.published), circleType: "circle", publishStatus: "published" },
            { _id: new ObjectId(ids.legacy), circleType: "circle" },
        ],
        Feeds: [
            feed("f-draft", ids.draft),
            feed("f-pending", ids.pending),
            feed("f-published", ids.published),
            feed("f-legacy", ids.legacy),
            feed("f-members-only", ids.published, ["admins", "moderators", "members"]),
        ],
    });
});

test("only published (or no-status) circles' public feeds", async () => {
    const feedIds = (await getPublicFeeds()).map((f) => String(f._id)).sort();
    expect(feedIds).toEqual(["f-legacy", "f-published"]);
});

test("with no unpublished circles at all, every public feed as before", async () => {
    await fakeDb.col("Circles").deleteMany({ publishStatus: { $in: ["draft", "pending_verification"] } });
    const feedIds = (await getPublicFeeds()).map((f) => String(f._id)).sort();
    expect(feedIds).toEqual(["f-draft", "f-legacy", "f-pending", "f-published"]);
});
