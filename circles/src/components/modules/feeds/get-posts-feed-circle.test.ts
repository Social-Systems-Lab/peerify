// Run: IS_BUILD=true bun test src/components/modules/feeds/get-posts-feed-circle.test.ts
// Leak round 3, M8 (2026-11-07): getPostsAction(feedId, circleId, …) checked the view permission on
// the circleId the client sends, not on the circle the feed belongs to. Sending a restricted feed's
// id together with an open circle's id returned that feed's posts. Now the permission is checked on
// feed.circleId. The database is in-memory fakes; the session and permission checks are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const OPEN_CIRCLE = "64f400000000000000000001"; // anyone may view its feed
const CLOSED_CIRCLE = "64f400000000000000000002"; // members only
const CLOSED_FEED = "64f4000000000000000000f2";
const OPEN_FEED = "64f4000000000000000000f1";
const STRANGER = "did:test:stranger";
const MEMBER = "did:test:member";
const SECRET_POST = "CANARY MEMBERS-ONLY POST";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, circleId: string) =>
        circleId === OPEN_CIRCLE || (circleId === CLOSED_CIRCLE && did === MEMBER),
}));

class Redirect extends Error {
    constructor(public url: string) {
        super("NEXT_REDIRECT");
    }
}
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    redirect: (url: string) => {
        throw new Redirect(url);
    },
}));
const realFeed = await import("@/lib/data/feed");
mock.module("@/lib/data/feed", () => ({
    ...realFeed,
    // Stands for the posts stored in whichever feed is asked for.
    getPostsWithMetrics: async (feedId: string) =>
        feedId === CLOSED_FEED ? [{ _id: "p1", content: SECRET_POST }] : [{ _id: "p2", content: "open post" }],
}));

const { getPostsAction } = await import("./actions");

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Feeds: [
            { _id: new ObjectId(OPEN_FEED), circleId: OPEN_CIRCLE, handle: "default" },
            { _id: new ObjectId(CLOSED_FEED), circleId: CLOSED_CIRCLE, handle: "default" },
        ],
    });
});

const read = async (feedId: string, circleId: string) => {
    try {
        return JSON.stringify(await getPostsAction(feedId, circleId, 10, 0));
    } catch (error) {
        if (error instanceof Redirect) return `redirect:${error.url}`;
        throw error;
    }
};

describe("getPostsAction", () => {
    test("a closed feed's id with an open circle's id: refused, no posts", async () => {
        for (const viewer of [STRANGER, undefined]) {
            sessionDid = viewer;
            const result = await read(CLOSED_FEED, OPEN_CIRCLE);
            expect(result).toBe("redirect:/unauthorized");
            expect(result).not.toContain(SECRET_POST);
        }
    });

    test("a member of the closed circle still reads its feed", async () => {
        sessionDid = MEMBER;
        expect(await read(CLOSED_FEED, CLOSED_CIRCLE)).toContain(SECRET_POST);
    });

    test("an open feed still reads for everyone", async () => {
        expect(await read(OPEN_FEED, OPEN_CIRCLE)).toContain("open post");
    });
});
