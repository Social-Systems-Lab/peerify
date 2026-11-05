// Run: IS_BUILD=true bun test src/lib/data/feed-metadata-leaks.test.ts
// Leak round 3, containment C3 (2026-11-05): feed and post payloads. Before the fix every post and
// comment carried its author's, circle's and mentioned circles' whole `metadata` (venue address,
// contact email and phone, booking note, signup/auth fields) to anyone who could read the post,
// logged out included; only `location` was redacted. Shared-post embeds carried whole documents.
// The database is in-memory fakes (testing/fake-db.ts); nothing real is touched.

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

const { redactPostLocationsForViewer, getShareablePostPreview, getAllComments } = await import("./feed");

const VENUE_ADDRESS = "Canary Home Venue 9";
const VENUE_EMAIL = "canary.venue@example.invalid";
const VENUE_PHONE = "+46 70 000 00 00";
const BOOKING_NOTE = "Canary booking note";
const SIGNUP = "canary-signup-intent";
const OFFER = "Canary crew offer";
const DONATION = "canary-donation-intent";

const leaks = (value: unknown) => {
    const t = JSON.stringify(value) ?? "";
    return {
        address: t.includes(VENUE_ADDRESS),
        contactEmail: t.includes(VENUE_EMAIL),
        phone: t.includes(VENUE_PHONE),
        bookingNote: t.includes(BOOKING_NOTE),
        signup: t.includes(SIGNUP),
        crewOffers: t.includes(OFFER),
        donation: t.includes(DONATION),
    };
};
const NONE = {
    address: false,
    contactEmail: false,
    phone: false,
    bookingNote: false,
    signup: false,
    crewOffers: false,
    donation: false,
};
// Signed-in viewers may see a venue's contact email, phone and booking note (Tim, 2026-10-08), as on
// the profile page (toPublicMetadata); nothing else here.
const SIGNED_IN = { ...NONE, contactEmail: true, phone: true, bookingNote: true };

const VENUE = "did:test:venue";
const STRANGER = "did:test:stranger";
const VENUE_ID = "64a000000000000000000a02";
const FEED_ID = "64a000000000000000000f01";
const POST_ID = "64a000000000000000000d01";

const venueMetadata = () => ({
    peerify: {
        intent: "venue",
        identityType: "venue",
        signupIntent: SIGNUP,
        venueProfile: {
            address: VENUE_ADDRESS,
            addressVisibility: "private",
            contactEmail: VENUE_EMAIL,
            phone: VENUE_PHONE,
            bookingNote: BOOKING_NOTE,
            accessibilityNotes: "Step-free entrance",
        },
    },
});
// The embedded author shape the feed aggregations build (metadata: "$authorDetails.metadata").
const venueAuthor = () => ({
    _id: VENUE_ID,
    did: VENUE,
    name: "Venue",
    handle: "venue",
    location: { precision: 2, city: "Stockholm" },
    metadata: venueMetadata(),
});

const feedPost = () => ({
    _id: POST_ID,
    createdBy: VENUE,
    content: "Gig tonight",
    author: venueAuthor(),
    circle: venueAuthor(),
    mentionsDisplay: [{ type: "circle", id: VENUE_ID, circle: venueAuthor() }],
    highlightedComment: { _id: "c1", author: venueAuthor(), mentionsDisplay: [{ circle: venueAuthor() }] },
});

beforeEach(() => {
    fakeDb.reset();
});

describe("posts in every feed (redactContentLocations)", () => {
    test("logged out: no private metadata on author, circle, mentions or highlighted comment", async () => {
        const post = await redactPostLocationsForViewer(feedPost() as any, undefined);

        expect(leaks(post)).toEqual(NONE);
        // Public identity metadata survives (artist/venue badges), and so do the public venue fields.
        expect((post as any).author.metadata.peerify.identityType).toBe("venue");
        expect((post as any).author.metadata.peerify.venueProfile.accessibilityNotes).toBe("Step-free entrance");
    });

    test("signed-in stranger: contact email, phone and booking note only, as on the profile page", async () => {
        const post = await redactPostLocationsForViewer(feedPost() as any, STRANGER);

        expect(leaks(post)).toEqual(SIGNED_IN);
    });

    test("the venue itself keeps its whole metadata", async () => {
        const post = await redactPostLocationsForViewer(feedPost() as any, VENUE);

        expect(leaks(post).address).toBe(true);
        expect(leaks(post).bookingNote).toBe(true);
    });
});

describe("comments (getAllComments)", () => {
    test("logged out: comment authors carry no private metadata", async () => {
        fakeDb.setAggregateResult("Comments", [
            { _id: "c1", postId: POST_ID, createdBy: VENUE, content: "Hi", author: venueAuthor() },
        ]);

        const comments = await getAllComments(POST_ID, undefined);

        expect(comments).toHaveLength(1);
        expect(leaks(comments)).toEqual(NONE);
    });
});

describe("shared-post embeds (getShareablePostPreview)", () => {
    test("the shared post's author and circle are identity only", async () => {
        fakeDb.reset({
            Posts: [
                {
                    _id: new ObjectId(POST_ID),
                    feedId: FEED_ID,
                    createdBy: VENUE,
                    content: "Gig tonight",
                    userGroups: ["everyone"],
                },
            ],
            Feeds: [{ _id: new ObjectId(FEED_ID), circleId: VENUE_ID, handle: "default" }],
            Circles: [
                {
                    _id: new ObjectId(VENUE_ID),
                    did: VENUE,
                    name: "Venue",
                    handle: "venue",
                    circleType: "circle",
                    isVerified: true,
                    location: { precision: 2, city: "Stockholm" },
                    metadata: venueMetadata(),
                    tourTeamOfferings: [{ type: "local_transport", description: OFFER }],
                    donationIntent: DONATION,
                },
            ],
        });

        const preview = await getShareablePostPreview(POST_ID, undefined);

        expect(preview).not.toBeNull();
        expect(leaks(preview)).toEqual(NONE);
        expect(preview!.author.name).toBe("Venue");
        expect((preview as any).circle.handle).toBe("venue");
    });
});
