// Run: IS_BUILD=true bun test src/app/api/pins/bookmark-unpublished.test.ts
// Round 3, item 6 (2026-10-20): no bookmarking or pinning (pinning also bookmarks) of an unpublished
// circle, through any path: toggleBookmarkAction, pinCircleAction and POST /api/pins. Removing an
// existing bookmark still works. In-memory fakes, session stubbed. The pin tests fail on the code
// before this change, which pinned and bookmarked any circle id.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const VIEWER = "did:test:viewer";
const DRAFT_ID = "64f000000000000000000001";
const PUBLISHED_ID = "64f000000000000000000002";

mock.module("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "token" }) }) }));
const realCookie = await import("@/lib/auth/cookie");
mock.module("@/lib/auth/cookie", () => ({ ...realCookie, readAuthToken: () => "token" }));
const realJwt = await import("@/lib/auth/jwt");
mock.module("@/lib/auth/jwt", () => ({ ...realJwt, verifyUserToken: async () => ({ userDid: VIEWER }) }));
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => VIEWER }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { toggleBookmarkAction, pinCircleAction } = await import("@/components/modules/home/actions");
const { POST: pinRoute } = await import("./route");

const viewerDoc = () => fakeDb.col("Circles").docs.find((d) => d.did === VIEWER)!;
const pinRequest = (circleId: string) =>
    new Request("http://test/api/pins", { method: "POST", body: JSON.stringify({ circleId }) }) as any;

beforeEach(() => {
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(), did: VIEWER, handle: "viewer", name: "Viewer", circleType: "user" },
            { _id: new ObjectId(DRAFT_ID), did: "did:test:draft", handle: "draft", circleType: "circle", publishStatus: "draft" },
            { _id: new ObjectId(PUBLISHED_ID), did: "did:test:pub", handle: "pub", circleType: "circle", publishStatus: "published" },
        ],
    });
});

describe("bookmarking and pinning unpublished circles", () => {
    test("pinCircleAction refuses an unpublished circle and bookmarks nothing", async () => {
        expect(await pinCircleAction(DRAFT_ID)).toBeUndefined();
        expect(viewerDoc().bookmarkedCircles ?? []).toEqual([]);
        expect(viewerDoc().pinnedCircles ?? []).toEqual([]);
    });

    test("POST /api/pins refuses an unpublished circle and bookmarks nothing", async () => {
        const response = await pinRoute(pinRequest(DRAFT_ID));
        expect(response.status).toBe(404);
        expect(viewerDoc().bookmarkedCircles ?? []).toEqual([]);
    });

    test("toggleBookmarkAction refuses an unpublished circle", async () => {
        expect(await toggleBookmarkAction(DRAFT_ID)).toBeUndefined();
        expect(viewerDoc().bookmarkedCircles ?? []).toEqual([]);
    });

    test("a published circle can still be pinned and bookmarked", async () => {
        const response = await pinRoute(pinRequest(PUBLISHED_ID));
        expect(response.status).toBe(200);
        expect(viewerDoc().bookmarkedCircles).toEqual([PUBLISHED_ID]);
        expect(viewerDoc().pinnedCircles).toEqual([PUBLISHED_ID]);
    });

    test("an existing bookmark of a circle that's now unpublished can still be removed", async () => {
        viewerDoc().bookmarkedCircles = [DRAFT_ID];
        await toggleBookmarkAction(DRAFT_ID);
        expect(viewerDoc().bookmarkedCircles).toEqual([]);
    });
});

// Personal profiles (2026-11-22): bookmarking follows the profile rule. Only the owner, superadmins
// and accepted connections, whatever the profile's search setting; following doesn't count.
describe("bookmarking a personal profile", () => {
    const STRANGER_PROFILE_ID = "64f000000000000000000003";
    const CONNECTION_PROFILE_ID = "64f000000000000000000004";
    const addProfiles = () => {
        fakeDb.col("Circles").docs.push(
            {
                _id: new ObjectId(STRANGER_PROFILE_ID),
                did: "did:test:stranger",
                handle: "stranger",
                circleType: "user",
                publishStatus: "published",
                searchable: true,
            },
            {
                _id: new ObjectId(CONNECTION_PROFILE_ID),
                did: "did:test:connection",
                handle: "connection",
                circleType: "user",
                publishStatus: "published",
                searchable: false,
            },
        );
        fakeDb.col("UserRelationships").docs.push({
            _id: new ObjectId(),
            fromDid: VIEWER,
            toDid: "did:test:connection",
            connectStatus: "accepted",
        });
        fakeDb.col("Members").docs.push({ userDid: VIEWER, circleId: STRANGER_PROFILE_ID, userGroups: ["members"] });
    };

    test("a profile the viewer only follows, even if searchable: refused", async () => {
        addProfiles();
        expect(await toggleBookmarkAction(STRANGER_PROFILE_ID)).toBeUndefined();
        expect(viewerDoc().bookmarkedCircles ?? []).toEqual([]);
    });

    test("an accepted connection's profile, even if not searchable: allowed", async () => {
        addProfiles();
        expect((await toggleBookmarkAction(CONNECTION_PROFILE_ID))?.bookmarkedCircles).toEqual([CONNECTION_PROFILE_ID]);
    });
});
