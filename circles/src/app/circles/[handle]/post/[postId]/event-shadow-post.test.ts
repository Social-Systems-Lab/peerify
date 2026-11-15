// Run: IS_BUILD=true bun test "src/app/circles/[handle]/post/[postId]/event-shadow-post.test.ts"
// The hidden post behind an event's comments (Tim's decision on D, 2026-11-15). createEvent makes it
// under the event author's personal account, and every visitor gets its id with the event
// (commentPostId). Opened as /circles/<venue>/post/<id>, the post page rendered it with the author's
// name, handle and picture; a post sharing it showed the same in its embed. Now that page sends the
// visitor to the event page, which has the event's own access rules and the same comments, and a
// shared embed of it is empty. The database is in-memory fakes; session and permissions stubbed.

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
    isAuthorized: async () => true, // the venue's Noticeboard is open to everyone
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
class Redirected extends Error {
    constructor(readonly url: string) {
        super(`redirect ${url}`);
    }
}
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    redirect: (url: string) => {
        throw new Redirected(url);
    },
    notFound: () => {
        throw new Error("notFound");
    },
}));

const { default: SinglePostPage } = await import("./page");
const { getShareablePostPreview } = await import("@/lib/data/feed");

const OWNER = "did:test:canary-owner";
const OWNER_NAME = "Canary Owner Name";
const OWNER_HANDLE = "canary-owner-handle";
const VENUE_ID = "64f000000000000000000001";
const OWNER_CIRCLE_ID = "64f000000000000000000002";
const FEED_ID = "64f000000000000000000f01";
const SHADOW_POST_ID = "64f0000000000000000000a1";
const NORMAL_POST_ID = "64f0000000000000000000a2";
const EVENT_ID = "64f0000000000000000000e1";

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(VENUE_ID),
                did: "did:test:venue",
                handle: "venue",
                name: "The Venue",
                circleType: "circle",
                publishStatus: "published",
            },
            {
                _id: new ObjectId(OWNER_CIRCLE_ID),
                did: OWNER,
                handle: OWNER_HANDLE,
                name: OWNER_NAME,
                circleType: "user",
                isVerified: true,
                isMember: true,
            },
        ],
        Feeds: [{ _id: new ObjectId(FEED_ID), circleId: VENUE_ID, handle: "default", name: "Noticeboard" }],
        Posts: [
            {
                _id: new ObjectId(SHADOW_POST_ID),
                feedId: FEED_ID,
                createdBy: OWNER,
                createdAt: new Date(),
                content: "Event: Julian Wenn, house concert",
                postType: "event",
                parentItemId: EVENT_ID,
                parentItemType: "event",
                userGroups: ["everyone"],
                comments: 0,
                reactions: {},
            },
            {
                _id: new ObjectId(NORMAL_POST_ID),
                feedId: FEED_ID,
                createdBy: OWNER,
                createdAt: new Date(),
                content: "An ordinary post",
                postType: "post",
                userGroups: ["everyone"],
                comments: 0,
                reactions: {},
            },
        ],
        Members: [],
        Comments: [],
    });
});

const openPostPage = async (postId: string) => {
    try {
        await SinglePostPage({ params: Promise.resolve({ handle: "venue", postId }) });
        return "rendered";
    } catch (error) {
        if (error instanceof Redirected) return error.url;
        throw error;
    }
};

describe("the post page for an event's hidden comment post", () => {
    test("signed out and signed in: sent to the event page, never rendered", async () => {
        for (const did of [undefined, "did:test:stranger"]) {
            sessionDid = did;
            expect(await openPostPage(SHADOW_POST_ID)).toBe(`/circles/venue/events/${EVENT_ID}`);
        }
    });

    test("an ordinary post still renders", async () => {
        expect(await openPostPage(NORMAL_POST_ID)).toBe("rendered");
    });
});

describe("a shared embed of it (getShareablePostPreview)", () => {
    test("is empty, so it never carries the author", async () => {
        expect(await getShareablePostPreview(SHADOW_POST_ID, undefined)).toBeNull();
        expect(await getShareablePostPreview(SHADOW_POST_ID, "did:test:stranger")).toBeNull();
    });

    test("an ordinary post's embed is unchanged", async () => {
        const preview = await getShareablePostPreview(NORMAL_POST_ID, undefined);
        expect(preview?.content).toBe("An ordinary post");
    });
});
