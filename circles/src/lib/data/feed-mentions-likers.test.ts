// Run: IS_BUILD=true bun test src/lib/data/feed-mentions-likers.test.ts
// Mentions and likers lists (Tim, 2026-11-23), trimmed like post authors: a personal profile the
// viewer has no relationship with is sent as name, handle and picture (plus did, and for mentions
// _id and circleType "user", so the preview panel asks the server). The profile itself, its
// accepted connections and superadmins get it as before; artist, band and venue circles are
// unchanged. Checks the returned payload.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, isAuthorized: async () => true }));

const { limitContentAuthorsForViewer, getAllComments, getReactions } = await import("./feed");

const PERSON = "did:test:person";
const PERSON_ID = "650000000000000000000081";
const FRIEND = "did:test:friend";
const STRANGER = "did:test:stranger";
const SUPERADMIN = "did:test:superadmin";
const BAND = "did:test:band";
const POST_ID = "650000000000000000000082";

// The mention shape the feed aggregations build (mentionsDetails): no circleType.
const personMention = () => ({
    type: "circle",
    id: PERSON_ID,
    circle: {
        _id: PERSON_ID,
        did: PERSON,
        name: "Mentioned Person",
        handle: "mentioned",
        picture: { url: "https://cdn.example/mentioned.png", fileName: "CANARY-file.png" },
        description: "CANARY about the person",
        cover: { url: "https://cdn.example/CANARY-cover.png" },
        location: { city: "CANARY City", country: "ZA" },
        metadata: { peerify: { intent: "fan" } },
    },
});
const bandMention = () => ({
    type: "circle",
    id: "650000000000000000000083",
    circle: { _id: "650000000000000000000083", did: BAND, name: "The Band", handle: "band", description: "Public" },
});
const LIMITED_MENTION = {
    _id: PERSON_ID,
    did: PERSON,
    circleType: "user",
    handle: "mentioned",
    name: "Mentioned Person",
    picture: { url: "https://cdn.example/mentioned.png" },
};

beforeEach(() =>
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(PERSON_ID),
                did: PERSON,
                circleType: "user",
                handle: "mentioned",
                name: "Mentioned Person",
                picture: { url: "https://cdn.example/mentioned.png" },
                description: "CANARY about the person",
                images: [{ fileInfo: { url: "https://cdn.example/CANARY-cover.png" } }],
                location: { city: "CANARY City", country: "ZA", precision: 2, lngLat: { lng: 18.4, lat: -33.9 } },
            },
            { _id: new ObjectId(), did: FRIEND, circleType: "user", handle: "friend", name: "Friend" },
            { _id: new ObjectId(), did: STRANGER, circleType: "user", handle: "stranger", name: "Stranger" },
            { _id: new ObjectId(), did: SUPERADMIN, circleType: "user", handle: "super", isAdmin: true },
            {
                _id: new ObjectId(),
                did: BAND,
                circleType: "circle",
                handle: "band",
                name: "The Band",
                description: "Public",
            },
        ],
        UserRelationships: [{ _id: new ObjectId(), fromDid: FRIEND, toDid: PERSON, connectStatus: "accepted" }],
        Reactions: [
            { _id: new ObjectId(), contentId: POST_ID, contentType: "post", reactionType: "like", userDid: PERSON },
            { _id: new ObjectId(), contentId: POST_ID, contentType: "post", reactionType: "like", userDid: BAND },
        ],
    }),
);

const post = () => ({
    _id: POST_ID,
    content: "Hi @mentioned",
    mentionsDisplay: [personMention(), bandMention()],
    highlightedComment: { _id: "c0", mentionsDisplay: [personMention()] },
    sharedPostData: { _id: "p0", mentionsDisplay: [personMention()] },
});

describe("mentions", () => {
    for (const [who, did] of [
        ["signed out", undefined],
        ["a signed-in stranger", STRANGER],
    ] as const) {
        test(`${who}: a mentioned person is name, handle and picture, in the post, highlighted comment and shared post`, async () => {
            const [shaped]: any[] = await limitContentAuthorsForViewer([post()], did);
            expect(shaped.mentionsDisplay[0]).toEqual({ type: "circle", id: PERSON_ID, circle: LIMITED_MENTION });
            expect(shaped.highlightedComment.mentionsDisplay[0].circle).toEqual(LIMITED_MENTION);
            expect(shaped.sharedPostData.mentionsDisplay[0].circle).toEqual(LIMITED_MENTION);
            expect(shaped.mentionsDisplay[1]).toEqual(bandMention());
            expect(JSON.stringify(shaped)).not.toContain("CANARY");
        });

        test(`${who}: comment mentions too (getAllComments)`, async () => {
            fakeDb.setAggregateResult("Comments", [
                { _id: "c1", postId: POST_ID, content: "Hi", mentionsDisplay: [personMention()] },
            ]);
            const comments: any[] = await getAllComments(POST_ID, did);
            expect(comments[0].mentionsDisplay[0].circle).toEqual(LIMITED_MENTION);
            expect(JSON.stringify(comments)).not.toContain("CANARY");
        });
    }

    for (const [who, did] of [
        ["the person", PERSON],
        ["an accepted connection", FRIEND],
        ["a superadmin", SUPERADMIN],
    ] as const) {
        test(`${who}: the mention as before`, async () => {
            const [shaped]: any[] = await limitContentAuthorsForViewer([post()], did);
            expect(shaped.mentionsDisplay[0]).toEqual(personMention());
        });
    }
});

describe("likers (getReactions)", () => {
    for (const [who, did] of [
        ["signed out", undefined],
        ["a signed-in stranger", STRANGER],
    ] as const) {
        test(`${who}: a liker who is a person is name, handle and picture; a band as before`, async () => {
            const likers: any[] = await getReactions(POST_ID, "post", did);
            const person = likers.find((l) => l.did === PERSON);
            expect(JSON.parse(JSON.stringify(person))).toEqual({
                did: PERSON,
                handle: "mentioned",
                name: "Mentioned Person",
                picture: { url: "https://cdn.example/mentioned.png" },
            });
            expect(likers.find((l) => l.did === BAND)?.description).toBe("Public");
            expect(JSON.stringify(likers)).not.toContain("CANARY");
        });
    }

    for (const [who, did] of [
        ["the person", PERSON],
        ["an accepted connection", FRIEND],
        ["a superadmin", SUPERADMIN],
    ] as const) {
        test(`${who}: the liker as before`, async () => {
            const likers: any[] = await getReactions(POST_ID, "post", did);
            expect(likers.find((l) => l.did === PERSON)?.description).toBe("CANARY about the person");
        });
    }
});
