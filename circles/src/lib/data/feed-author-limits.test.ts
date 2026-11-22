// Run: IS_BUILD=true bun test src/lib/data/feed-author-limits.test.ts
// Post and comment authors (Tim, 2026-11-22): an author who is a personal profile the viewer has
// no relationship with is sent as name, handle and picture only (plus _id, did and circleType for
// linking). The author themselves, their accepted connections and superadmins get the author as
// before; artist, band and venue authors are unchanged. Checks the returned payload.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, isAuthorized: async () => true }));

const { redactPostLocationsForViewer, getAllComments, limitContentAuthorsForViewer } = await import("./feed");

const AUTHOR = "did:test:author";
const AUTHOR_ID = "650000000000000000000051";
const FRIEND = "did:test:friend";
const STRANGER = "did:test:stranger";
const SUPERADMIN = "did:test:superadmin";
const BAND = "did:test:band";
const POST_ID = "650000000000000000000052";

// The embedded author shape the feed aggregations build.
const personAuthor = () => ({
    _id: AUTHOR_ID,
    did: AUTHOR,
    name: "Author Name",
    handle: "author",
    picture: { url: "https://cdn.example/author.png", fileName: "CANARY-file.png" },
    description: "CANARY about the author",
    images: [{ fileInfo: { url: "https://cdn.example/CANARY-cover.png" } }],
    location: { city: "CANARY City", country: "ZA" },
    isVerified: true,
    metadata: { peerify: { intent: "fan" } },
});
const bandAuthor = () => ({
    _id: "650000000000000000000053",
    did: BAND,
    name: "The Band",
    handle: "band",
    description: "Public band text",
});
const LIMITED_AUTHOR = {
    _id: AUTHOR_ID,
    did: AUTHOR,
    handle: "author",
    name: "Author Name",
    picture: { url: "https://cdn.example/author.png" },
    circleType: "user",
};

beforeEach(() =>
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(AUTHOR_ID), did: AUTHOR, circleType: "user", handle: "author" },
            { _id: new ObjectId(), did: FRIEND, circleType: "user", handle: "friend" },
            { _id: new ObjectId(), did: STRANGER, circleType: "user", handle: "stranger" },
            { _id: new ObjectId(), did: SUPERADMIN, circleType: "user", handle: "super", isAdmin: true },
            { _id: new ObjectId(), did: BAND, circleType: "circle", handle: "band" },
        ],
        UserRelationships: [{ _id: new ObjectId(), fromDid: FRIEND, toDid: AUTHOR, connectStatus: "accepted" }],
    }),
);

const post = () => ({
    _id: POST_ID,
    createdBy: AUTHOR,
    content: "Hello",
    author: personAuthor(),
    highlightedComment: { _id: "c0", createdBy: AUTHOR, author: personAuthor() },
    sharedPostData: { _id: "p0", createdBy: AUTHOR, author: personAuthor() },
});

describe("a personal profile author", () => {
    for (const [who, did] of [
        ["signed out", undefined],
        ["a signed-in stranger", STRANGER],
    ] as const) {
        test(`${who}: post, highlighted comment and shared post authors are name, handle, picture`, async () => {
            const shaped: any = await redactPostLocationsForViewer(post() as any, did);
            expect(shaped.author).toEqual(LIMITED_AUTHOR);
            expect(shaped.highlightedComment.author).toEqual(LIMITED_AUTHOR);
            expect(shaped.sharedPostData.author).toEqual(LIMITED_AUTHOR);
            expect(JSON.stringify(shaped)).not.toContain("CANARY");
            expect(shaped.content).toBe("Hello");
        });

        test(`${who}: comment authors too (getAllComments)`, async () => {
            fakeDb.setAggregateResult("Comments", [
                { _id: "c1", postId: POST_ID, createdBy: AUTHOR, content: "Hi", author: personAuthor() },
            ]);
            const comments: any[] = await getAllComments(POST_ID, did);
            expect(comments[0].author).toEqual(LIMITED_AUTHOR);
            expect(JSON.stringify(comments)).not.toContain("CANARY");
        });
    }

    for (const [who, did] of [
        ["the author", AUTHOR],
        ["an accepted connection", FRIEND],
        ["a superadmin", SUPERADMIN],
    ] as const) {
        test(`${who}: the author as before`, async () => {
            const [shaped]: any[] = await limitContentAuthorsForViewer([post()], did);
            expect(shaped.author.description).toBe("CANARY about the author");
            expect(shaped.author.isVerified).toBe(true);
        });
    }
});

describe("artist, band and venue authors", () => {
    test("unchanged for a stranger", async () => {
        const [shaped]: any[] = await limitContentAuthorsForViewer([{ author: bandAuthor() }], STRANGER);
        expect(shaped.author).toEqual(bandAuthor());
    });
});
