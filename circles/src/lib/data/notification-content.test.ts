// Run: IS_BUILD=true bun test src/lib/data/notification-content.test.ts
// Leak round 3, containment C1 (2026-11-05): notification content holds identity only.
// Before the fix, sendNotifications stored whole user/circle documents and /api/notifications
// (listNotificationsForUser) returned them: other people's exact location, email, memberships,
// Matrix credentials and venue contacts. Mentions also reached people who can't see the post.
// Follow-up (2026-11-06): artist, venue and other circles have no `did` (createCircle never sets
// one), and the shaping dropped them whole, so the bell lost its links and Review buttons for them.
// The fixtures used to give the venue a `did`, which hid that; real circles are used below.
// The database is in-memory fakes (testing/fake-db.ts); nothing real is touched.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    // Every feed is viewable; the per-post userGroups check in canUserViewPost still applies.
    isAuthorized: async () => true,
    getAuthenticatedUserDid: async () => undefined,
}));

const { sendNotifications, listNotificationsForUser, notifyPostMentions, shapeNotificationContent } = await import(
    "./notifications"
);

const STREET = "Canary Street 7";
const LNG = 18.071234;
const EMAIL = "canary.person@example.invalid";
const VENUE_EMAIL = "canary.venue@example.invalid";
const VENUE_PHONE = "+46 70 000 00 00";
const VENUE_ADDRESS = "Canary Home Venue 9";
const BOOKING_NOTE = "canary booking note: call after 6";
const ARTIST_EMAIL = "canary.artist@example.invalid";
const MATRIX = "canary-matrix-password";
const PRIVATE_CIRCLE = "Canary private circle";
const POST_TEXT = "canary members-only post text";

const CANARIES = [
    STREET,
    String(LNG),
    EMAIL,
    VENUE_EMAIL,
    VENUE_PHONE,
    VENUE_ADDRESS,
    BOOKING_NOTE,
    ARTIST_EMAIL,
    MATRIX,
    PRIVATE_CIRCLE,
    POST_TEXT,
];
const leaked = (value: unknown) => {
    const text = JSON.stringify(value) ?? "";
    return CANARIES.filter((canary) => text.includes(canary));
};

const RECIPIENT = "did:test:recipient";
const PERSON = "did:test:person";

// A whole user document as getUserPrivate returns it.
const rawPerson = () => ({
    _id: "64a000000000000000000b01",
    did: PERSON,
    handle: "person",
    name: "Person",
    picture: { url: "/p.png" },
    circleType: "user",
    email: EMAIL,
    matrixPassword: MATRIX,
    location: { precision: 4, city: "Stockholm", street: STREET, lngLat: { lng: LNG, lat: 59.3 } },
    memberships: [{ circle: { name: PRIVATE_CIRCLE } }],
    metadata: { peerify: { intent: "fan" } },
});
// Whole circle documents as getCircleById returns them (SAFE_CIRCLE_PROJECTION). Like real artist
// and venue circles, they have no `did`.
const venueCircle = () => ({
    _id: "64a000000000000000000b02",
    handle: "venue",
    name: "Venue",
    picture: { url: "/v.png" },
    circleType: "circle",
    createdBy: PERSON,
    location: { precision: 4, city: "Stockholm", street: STREET, lngLat: { lng: LNG, lat: 59.3 } },
    accessRules: { feed: { view: ["everyone"] }, general: { manage_crew_applications: ["admins"] } },
    metadata: {
        peerify: {
            identityType: "venue",
            venueProfile: {
                address: VENUE_ADDRESS,
                addressVisibility: "private",
                contactEmail: VENUE_EMAIL,
                phone: VENUE_PHONE,
                bookingNote: BOOKING_NOTE,
            },
        },
    },
});
const artistCircle = () => ({
    _id: "64a000000000000000000b03",
    handle: "artist",
    name: "Artist",
    picture: { url: "/a.png" },
    circleType: "circle",
    createdBy: PERSON,
    crewEnabled: true,
    location: { precision: 4, city: "Stockholm", street: STREET, lngLat: { lng: LNG, lat: 59.3 } },
    accessRules: { general: { manage_crew_applications: ["admins", "moderators"] } },
    metadata: { peerify: { identityType: "band", contactEmail: ARTIST_EMAIL, bookingNote: BOOKING_NOTE } },
});
// What the bell needs, and nothing else.
const identityOf = (circle: ReturnType<typeof venueCircle> | ReturnType<typeof artistCircle>) => ({
    _id: circle._id,
    handle: circle.handle,
    name: circle.name,
    picture: circle.picture,
    circleType: circle.circleType,
});
const expectIdentityOnly = (shapedCircle: any, circle: ReturnType<typeof venueCircle> | ReturnType<typeof artistCircle>) => {
    expect(shapedCircle).toEqual(identityOf(circle));
    expect(shapedCircle.location).toBeUndefined();
    expect(shapedCircle.metadata).toBeUndefined();
    expect(shapedCircle.accessRules).toBeUndefined();
};

beforeEach(() => {
    fakeDb.reset();
});

describe("shapeNotificationContent", () => {
    test("people and circles become identity only; the bell's fields and erasure keys survive", () => {
        const shaped = shapeNotificationContent({
            user: rawPerson(),
            circle: venueCircle(),
            post: {
                _id: "p1",
                createdBy: PERSON,
                postType: "post",
                parentItemType: "issue",
                parentItemId: "i1",
                content: POST_TEXT,
                location: { street: STREET },
                author: rawPerson(),
            },
            comment: { _id: "c1", postId: "p1", createdBy: PERSON, content: POST_TEXT },
            event: { _id: "e1", title: "Gig", location: { street: STREET } },
            track: { _id: "t1", title: "Song", circle: venueCircle() },
            postId: "p1",
            roleNames: ["Admin"],
            body: "Person followed you",
        }) as any;

        expect(leaked(shaped)).toEqual([]);
        expect(shaped.user).toEqual({
            _id: "64a000000000000000000b01",
            did: PERSON,
            handle: "person",
            name: "Person",
            picture: { url: "/p.png" },
            circleType: "user",
        });
        expectIdentityOnly(shaped.circle, venueCircle());
        expect(shaped.post).toEqual({
            _id: "p1",
            createdBy: PERSON,
            postType: "post",
            parentItemType: "issue",
            parentItemId: "i1",
        });
        expect(shaped.comment).toEqual({ _id: "c1", postId: "p1", createdBy: PERSON });
        expect(shaped.event).toEqual({ _id: "e1", title: "Gig" });
        expect(shaped.track).toBeUndefined();
        expect(shaped.postId).toBe("p1");
        expect(shaped.roleNames).toEqual(["Admin"]);
        expect(shaped.body).toBe("Person followed you");
    });
});

describe("/api/notifications reader (listNotificationsForUser)", () => {
    test("a notification stored with whole documents comes back identity only", async () => {
        fakeDb.reset({
            Notifications: [
                {
                    _id: "n1",
                    userId: RECIPIENT,
                    type: "admin_invitation_decided",
                    content: { user: rawPerson(), circle: venueCircle(), accepted: false },
                    isRead: false,
                    createdAt: new Date("2026-10-01T00:00:00Z"),
                },
            ],
        });

        const [notification] = await listNotificationsForUser(RECIPIENT);

        expect(leaked(notification)).toEqual([]);
        expect(notification.content.user.did).toBe(PERSON);
        expect(notification.content.circle.handle).toBe("venue");
        expect(notification.content.accepted).toBe(false);
    });
});

describe("sendNotifications stores identity only", () => {
    test("following a circle: the follower's notification no longer holds the circle's document", async () => {
        await sendNotifications("new_following", [{ did: RECIPIENT }], { circle: venueCircle(), userDid: RECIPIENT });

        const stored = fakeDb.col("Notifications").docs;
        expect(stored).toHaveLength(1);
        expect(leaked(stored[0])).toEqual([]);
        expect(stored[0].content.circle.handle).toBe("venue");
        expect(typeof stored[0].content.body).toBe("string");
    });

    test("an invitation decision: the inviter's notification no longer holds the invitee's private record", async () => {
        await sendNotifications("admin_invitation_decided", [{ did: RECIPIENT }], {
            user: rawPerson(),
            circle: venueCircle(),
            accepted: true,
        });

        const [stored] = fakeDb.col("Notifications").docs;
        expect(leaked(stored)).toEqual([]);
        expect(stored.content.user.name).toBe("Person");
    });
});

describe("circles without a did (artists, venues) keep their identity, nothing more", () => {
    test("crew_application to an artist circle: stored with circle _id and handle, no location, metadata or rules", async () => {
        await sendNotifications("crew_application", [{ did: RECIPIENT }], { circle: artistCircle(), user: rawPerson() });

        const [stored] = fakeDb.col("Notifications").docs;
        expect(leaked(stored)).toEqual([]);
        expectIdentityOnly(stored.content.circle, artistCircle());
        expect(stored.content.circle._id).toBe("64a000000000000000000b03");
        expect(stored.content.circle.handle).toBe("artist");
        expect(stored.content.user.did).toBe(PERSON);
    });

    test("crew_application to a venue: contact email, phone, booking note and private address stay out", async () => {
        await sendNotifications("crew_application", [{ did: RECIPIENT }], { circle: venueCircle(), user: rawPerson() });

        const [stored] = fakeDb.col("Notifications").docs;
        expect(leaked(stored)).toEqual([]);
        expectIdentityOnly(stored.content.circle, venueCircle());
        expect(stored.content.circle.handle).toBe("venue");
    });

    test("an older notification stored with the whole artist document comes back with its handle", async () => {
        fakeDb.reset({
            Notifications: [
                {
                    _id: "n2",
                    userId: RECIPIENT,
                    type: "crew_application",
                    content: { circle: artistCircle(), user: rawPerson(), body: "Person applied to join Artist's Crew" },
                    isRead: false,
                    createdAt: new Date("2026-10-28T00:00:00Z"),
                },
            ],
        });

        const [notification] = await listNotificationsForUser(RECIPIENT);

        expect(leaked(notification)).toEqual([]);
        expectIdentityOnly(notification.content.circle, artistCircle());
    });

    test("artistCircle and targetParentCircle are kept as identity too", () => {
        const shaped = shapeNotificationContent({
            circle: venueCircle(),
            artistCircle: artistCircle(),
            targetParentCircle: venueCircle(),
            eventId: "e1",
        }) as any;

        expect(leaked(shaped)).toEqual([]);
        expectIdentityOnly(shaped.artistCircle, artistCircle());
        expectIdentityOnly(shaped.targetParentCircle, venueCircle());
    });
});

describe("mentions reach only people who can see the post", () => {
    test("a members-only post: a mentioned non-member gets no notification", async () => {
        fakeDb.reset({
            Circles: [
                { _id: "64a000000000000000000b10", did: "did:test:author", circleType: "user", isVerified: true, name: "Author" },
                { _id: "64a000000000000000000b11", did: PERSON, circleType: "user", isVerified: true, name: "Person" },
            ],
            Feeds: [{ _id: new ObjectId("64a000000000000000000f01"), circleId: "64a000000000000000000c01", handle: "default" }],
            Members: [],
        });
        const post = {
            _id: "64a000000000000000000p01",
            feedId: "64a000000000000000000f01",
            createdBy: "did:test:author",
            content: POST_TEXT,
            userGroups: ["members"],
        } as any;

        await notifyPostMentions(post, { did: "did:test:author", name: "Author" } as any, [{ did: PERSON } as any]);

        expect(fakeDb.col("Notifications").docs).toHaveLength(0);
    });

    test("an open post: the mentioned person is notified, with identity only", async () => {
        fakeDb.reset({
            Circles: [
                { _id: "64a000000000000000000b10", did: "did:test:author", circleType: "user", isVerified: true, name: "Author" },
                { _id: "64a000000000000000000b11", did: PERSON, circleType: "user", isVerified: true, name: "Person" },
            ],
            Feeds: [{ _id: new ObjectId("64a000000000000000000f01"), circleId: "64a000000000000000000c01", handle: "default" }],
        });
        const post = {
            _id: "64a000000000000000000p02",
            feedId: "64a000000000000000000f01",
            createdBy: "did:test:author",
            content: POST_TEXT,
            userGroups: ["everyone"],
        } as any;

        // The author payload is a whole document, as the post actions pass it.
        await notifyPostMentions(post, { ...rawPerson(), did: "did:test:author" } as any, [{ did: PERSON } as any]);

        const docs = fakeDb.col("Notifications").docs;
        expect(docs.map((d) => d.userId)).toEqual([PERSON]);
        expect(leaked(docs[0])).toEqual([]);
    });
});
