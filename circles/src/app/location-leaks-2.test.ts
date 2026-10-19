// Run: IS_BUILD=true bun test src/app/location-leaks-2.test.ts
// Round 2 of the 2026-10-19 location leak fixes, through every path that reads circles with
// getCirclesByIds/getCirclesByDids and hands them to a browser: bookmarks and pins, the /circles
// following tab, the global-create circle picker, event artists, invited and member lists, chat
// messages and rooms, and task shift reviewers (the data layer is in
// src/lib/data/location-leaks-2.test.ts). The database is in-memory fakes (testing/fake-db.ts),
// and the session, permission and chat-access checks are stubbed, so nothing real is touched. The
// leak tests fail on the code before the fix: the stored street, exact pin, venue address or Crew
// Offers came back to someone who doesn't own the circle.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
// "did|circleId|module.feature" entries; everything else is refused.
const grants = new Set<string>();
const grantKey = (did: string, circleId: string, feature: { module?: string; handle?: string }) =>
    `${did}|${circleId}|${feature?.module}.${feature?.handle}`;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, circleId: string, feature: any) =>
        !!did && grants.has(grantKey(did, String(circleId), feature)),
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
mock.module("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "token" }) }) }));
const realCookie = await import("@/lib/auth/cookie");
mock.module("@/lib/auth/cookie", () => ({ ...realCookie, readAuthToken: () => "token" }));
const realJwt = await import("@/lib/auth/jwt");
mock.module("@/lib/auth/jwt", () => ({ ...realJwt, verifyUserToken: async () => ({ userDid: sessionDid }) }));

// The signed-in user's own private document (bookmarks, pins, memberships), by did.
const privateUsers = new Map<string, Record<string, unknown>>();
const realUser = await import("@/lib/data/user");
mock.module("@/lib/data/user", () => ({
    ...realUser,
    getUserPrivate: async (did: string) => privateUsers.get(did),
}));

// Chat: access is granted, and the message reads return the docs set by the test.
let chatDocs: Record<string, unknown>[] = [];
const realMongoChat = await import("@/lib/data/mongo-chat");
mock.module("@/lib/data/mongo-chat", () => ({
    ...realMongoChat,
    resolveMongoConversationAccess: async () => ({ ok: true, conversation: { _id: CONVERSATION_ID, type: "dm" } }),
    fetchRecentMessages: async () => chatDocs,
    fetchMessagesSince: async () => chatDocs,
    fetchTopicStarters: async () => chatDocs,
    fetchThreadReplies: async () => chatDocs,
    findThreadStarter: async () => ({ _id: "thread-1" }),
}));

// Tasks: one shift task, visible to everyone who asks.
const realTask = await import("@/lib/data/task");
mock.module("@/lib/data/task", () => ({
    ...realTask,
    getTaskById: async () => ({
        _id: "task-1",
        circleId: HOST_ID,
        taskType: "shift",
        participants: [{ did: STRANGER, attendanceVerifiedBy: OWNER }],
    }),
    filterTasksForViewer: async (tasks: unknown[]) => tasks,
}));

// Page children: keep their props, skip their client-side code.
mock.module("@/app/bookmarks/bookmark-card", () => ({ default: (props: unknown) => props }));
mock.module("@/components/modules/circles/circles-list", () => ({ default: (props: unknown) => props }));
mock.module("@/components/modules/circles/circles-tab", () => ({ default: () => null }));

const STREET = "Teststraat 1";
const EXACT = { lng: 18.071234, lat: 59.325678 };
const VENUE_ADDRESS = "Hemlig gatan 9";
const OFFER = "Secret crew offer";
const PRIVATE_META = "private-onboarding-flow";
const exactLocation = () => ({
    precision: 4,
    country: "Sweden",
    region: "Stockholm",
    city: "Stockholm",
    street: STREET,
    lngLat: { ...EXACT },
});

const OWNER = "did:test:owner";
const STRANGER = "did:test:stranger";
const ADMIN = "did:test:admin";
const ARTIST_ID = "64a000000000000000000b01";
const HOST_ID = "64a000000000000000000b02";
const STRANGER_ID = "64a000000000000000000b03";
const ADMIN_ID = "64a000000000000000000b04";
const EVENT_ID = "64a000000000000000000be1";
const CONVERSATION_ID = "64a000000000000000000bc1";

const leaks = (output: unknown) => {
    const text = JSON.stringify(output) ?? "";
    return {
        street: text.includes(STREET),
        exactPin: text.includes(String(EXACT.lng)) || text.includes(String(EXACT.lat)),
        venueAddress: text.includes(VENUE_ADDRESS),
        crewOffers: text.includes(OFFER),
        privateMetadata: text.includes(PRIVATE_META),
    };
};
const NO_LEAKS = { street: false, exactPin: false, venueAddress: false, crewOffers: false, privateMetadata: false };
const ALL_LEAKS = { street: true, exactPin: true, venueAddress: true, crewOffers: true, privateMetadata: true };

// The owner's artist profile: exact (unconfirmed) location, Crew Offers, private onboarding data.
const artist = () => ({
    _id: new ObjectId(ARTIST_ID),
    did: OWNER,
    handle: "artist",
    name: "Artist",
    circleType: "user",
    publishStatus: "published",
    location: exactLocation(),
    tourTeamOfferings: [{ id: "o1", title: OFFER }],
    metadata: { peerify: { intent: "artist", onboardingFlow: PRIVATE_META } },
});
// A venue the owner created, with a private address and default event tags.
const host = () => ({
    _id: new ObjectId(HOST_ID),
    did: "did:test:host",
    createdBy: OWNER,
    handle: "host",
    name: "Host venue",
    circleType: "circle",
    publishStatus: "published",
    enabledModules: ["events"],
    defaultEventTags: ["stage"],
    location: exactLocation(),
    metadata: {
        peerify: {
            identityType: "venue",
            managedIdentity: true,
            venueProfile: { address: VENUE_ADDRESS, addressVisibility: "private" },
        },
    },
});
const userCircle = (id: string, did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(id),
    did,
    handle: did.split(":").pop(),
    name: did,
    circleType: "user",
    isVerified: true,
    ...extra,
});

beforeEach(() => {
    sessionDid = undefined;
    grants.clear();
    privateUsers.clear();
    chatDocs = [];
    fakeDb.reset({
        Circles: [artist(), host(), userCircle(STRANGER_ID, STRANGER), userCircle(ADMIN_ID, ADMIN, { isAdmin: true })],
    });
    for (const [id, did] of [
        [STRANGER_ID, STRANGER],
        [ADMIN_ID, ADMIN],
        [ARTIST_ID, OWNER],
    ] as const) {
        privateUsers.set(did, {
            _id: id,
            did,
            circleType: "user",
            isVerified: true,
            bookmarkedCircles: [ARTIST_ID, HOST_ID],
            pinnedCircles: [ARTIST_ID],
            memberships: [{ circle: { _id: ARTIST_ID, circleType: "user", handle: "artist" } }],
        });
    }
});

const signedInAs = (did: string) => {
    sessionDid = did;
};

describe("bookmarks and pins", async () => {
    const { GET: bookmarksApi } = await import("@/app/api/bookmarks/route");
    const { GET: pinsApi } = await import("@/app/api/pins/route");
    const { getBookmarkedCirclesAction } = await import("@/components/modules/home/actions");
    const { default: BookmarksPage } = await import("@/app/bookmarks/page");

    const allPaths = async () => [
        await (await bookmarksApi()).json(),
        await (await pinsApi()).json(),
        await getBookmarkedCirclesAction(),
        await BookmarksPage(),
    ];

    test("a stranger who bookmarked and pinned both circles gets no private data on any path", async () => {
        signedInAs(STRANGER);
        const outputs = await allPaths();
        expect((outputs[0] as unknown[]).length).toBe(2);
        expect((outputs[1] as unknown[]).length).toBe(1);
        expect((outputs[2] as unknown[]).length).toBe(2);
        for (const output of outputs) {
            expect(leaks(output)).toEqual(NO_LEAKS);
        }
    });

    test("the owner still gets the whole documents", async () => {
        signedInAs(OWNER);
        expect(leaks(await (await bookmarksApi()).json())).toEqual(ALL_LEAKS);
    });

    test("a platform admin still gets the whole documents", async () => {
        signedInAs(ADMIN);
        expect(leaks(await getBookmarkedCirclesAction())).toEqual(ALL_LEAKS);
    });
});

describe("/circles following tab", async () => {
    const { default: CirclesPage } = await import("@/app/circles/page");
    const render = () =>
        CirclesPage({
            params: Promise.resolve({ handle: "" }),
            searchParams: Promise.resolve({ tab: "following", circleType: "user" }),
        } as any);

    test("a stranger following the artist gets no private data", async () => {
        signedInAs(STRANGER);
        const page = await render();
        expect(JSON.stringify(page)).toContain('"name":"Artist"');
        expect(leaks(page)).toEqual(NO_LEAKS);
    });

    test("the owner still gets the whole document", async () => {
        signedInAs(OWNER);
        expect(leaks(await render())).toEqual({ ...ALL_LEAKS, venueAddress: false });
    });
});

describe("global-create circle picker (getSelectableCirclesAction)", async () => {
    const { getSelectableCirclesAction } = await import("@/components/global-create/actions");
    const pick = async () => {
        const result = await getSelectableCirclesAction("events", "create");
        return result.circles.find((c) => c._id === HOST_ID);
    };

    beforeEach(() => {
        fakeDb.reset({
            Circles: [host(), userCircle(STRANGER_ID, STRANGER), userCircle(ADMIN_ID, ADMIN, { isAdmin: true })],
            Members: [
                { userDid: STRANGER, circleId: HOST_ID },
                { userDid: ADMIN, circleId: HOST_ID },
                { userDid: "did:test:manager", circleId: HOST_ID },
            ],
        });
        privateUsers.set("did:test:manager", {
            _id: "64a000000000000000000b05",
            did: "did:test:manager",
            isVerified: true,
        });
        for (const did of [STRANGER, ADMIN, "did:test:manager"]) {
            grants.add(grantKey(did, HOST_ID, features.events.create));
        }
        grants.add(grantKey("did:test:manager", HOST_ID, features.settings.edit_about));
    });

    test("a member who may create events but not manage the venue: city only, no pin, no address", async () => {
        signedInAs(STRANGER);
        const circle = await pick();
        expect(circle?.name).toBe("Host venue");
        expect(circle?.location).toEqual({ precision: 2, country: "Sweden", region: "Stockholm", city: "Stockholm" });
        expect(leaks(circle)).toEqual(NO_LEAKS);
    });

    test("the venue's default event tags still reach the event form", async () => {
        signedInAs(STRANGER);
        expect((await pick())?.defaultEventTags).toEqual(["stage"]);
    });

    test("a manager of the venue gets the whole document (the event form pre-fills its address)", async () => {
        signedInAs("did:test:manager");
        const circle = await pick();
        expect(circle?.location).toEqual(exactLocation());
        expect(leaks(circle).venueAddress).toBe(true);
    });

    test("a platform admin gets the whole document", async () => {
        signedInAs(ADMIN);
        expect(leaks(await pick()).street).toBe(true);
    });
});

describe("event artists, invited users and the member picker", async () => {
    const { getEventArtistsAction, getInvitedUsersAction, getCircleMembersAction } = await import(
        "@/app/circles/[handle]/events/actions"
    );

    beforeEach(() => {
        fakeDb.reset({
            Circles: [
                artist(),
                host(),
                userCircle(STRANGER_ID, STRANGER),
                userCircle(ADMIN_ID, ADMIN, { isAdmin: true }),
            ],
            Events: [
                {
                    _id: new ObjectId(EVENT_ID),
                    circleId: HOST_ID,
                    title: "Show",
                    stage: "open",
                    createdBy: "did:test:host",
                    additionalArtistCircleIds: [ARTIST_ID],
                },
            ],
            EventInvitations: [{ eventId: EVENT_ID, userDid: OWNER }],
        });
        fakeDb.setAggregateResult("Members", [
            { _id: "m1", circleId: HOST_ID, userDid: OWNER, userGroups: ["members"] },
        ]);
        for (const did of [STRANGER, OWNER, ADMIN]) {
            grants.add(grantKey(did, HOST_ID, features.events.view));
        }
    });

    test("a stranger gets the invitee and member without private data", async () => {
        signedInAs(STRANGER);
        const invited = await getInvitedUsersAction("host", EVENT_ID);
        const members = await getCircleMembersAction("host");
        expect(invited.users.map((u) => u.did)).toEqual([OWNER]);
        expect(members.members.map((u) => u.did)).toEqual([OWNER]);
        expect(leaks(invited)).toEqual(NO_LEAKS);
        expect(leaks(members)).toEqual(NO_LEAKS);
    });

    test("event artists: the coarse pin survives (redacted once, not twice)", async () => {
        signedInAs(STRANGER);
        fakeDb.setAggregateResult("Events", [
            { _id: EVENT_ID, circleId: HOST_ID, title: "Show", stage: "open", additionalArtistCircleIds: [ARTIST_ID] },
        ]);
        const { bands } = await getEventArtistsAction("host", EVENT_ID);
        expect(bands).toHaveLength(1);
        expect(bands[0].circle.location?.lngLat).not.toBeUndefined();
        expect(leaks(bands)).toEqual(NO_LEAKS);
    });

    test("the invitee themself and a platform admin still get the whole document", async () => {
        signedInAs(OWNER);
        expect(leaks(await getInvitedUsersAction("host", EVENT_ID))).toEqual({ ...ALL_LEAKS, venueAddress: false });
        signedInAs(ADMIN);
        expect(leaks(await getCircleMembersAction("host"))).toEqual({ ...ALL_LEAKS, venueAddress: false });
    });
});

describe("chat", async () => {
    const actions = await import("@/components/modules/chat/mongo-actions");
    const { mapConversationToChatRoomDisplay } = await import("@/lib/data/mongo-chat");
    const message = () => ({
        _id: new ObjectId(),
        conversationId: CONVERSATION_ID,
        senderDid: OWNER,
        body: "hello",
        createdAt: new Date("2026-10-19T10:00:00Z"),
    });
    const allMessagePaths = async () => [
        await actions.fetchRecentMessagesAction(CONVERSATION_ID),
        await actions.fetchMongoMessagesAction(CONVERSATION_ID),
        await actions.fetchThreadRepliesAction("thread-1", CONVERSATION_ID),
        await actions.fetchTopicStartersAction(CONVERSATION_ID),
    ];

    test("message authors: a stranger gets the artist without private data on all four reads", async () => {
        signedInAs(STRANGER);
        chatDocs = [message()];
        const outputs = await allMessagePaths();
        for (const output of outputs) {
            expect(output.success).toBe(true);
            expect(JSON.stringify(output)).toContain("Artist");
            expect(leaks(output)).toEqual(NO_LEAKS);
        }
    });

    test("message authors: the author themself still gets their whole document", async () => {
        signedInAs(OWNER);
        chatDocs = [message()];
        expect(leaks(await actions.fetchRecentMessagesAction(CONVERSATION_ID))).toEqual({
            ...ALL_LEAKS,
            venueAddress: false,
        });
    });

    test("a DM room's participant circles: no private data for the other side", async () => {
        const room = await mapConversationToChatRoomDisplay(STRANGER, {
            _id: CONVERSATION_ID,
            type: "dm",
            participants: [STRANGER, OWNER],
            createdAt: new Date(),
            updatedAt: new Date(),
        } as any);
        // participantCircles is set by mapConversationsToChatRoomDisplays but not on the ChatRoomDisplay type.
        const participants = (room as { participantCircles?: { did?: string }[] } | null)?.participantCircles;
        expect(participants?.map((c) => c.did).sort()).toEqual([OWNER, STRANGER].sort());
        expect(leaks(room)).toEqual(NO_LEAKS);
    });
});

describe("task shift reviewers (getShiftViewerContextAction)", async () => {
    const { getShiftViewerContextAction } = await import("@/app/circles/[handle]/tasks/actions");

    test("a stranger gets the reviewer without private data", async () => {
        signedInAs(STRANGER);
        const { reviewerProfiles } = await getShiftViewerContextAction("host", "task-1");
        expect(reviewerProfiles.map((c) => c.did)).toEqual([OWNER]);
        expect(leaks(reviewerProfiles)).toEqual(NO_LEAKS);
    });

    test("a platform admin still gets the whole document", async () => {
        signedInAs(ADMIN);
        const { reviewerProfiles } = await getShiftViewerContextAction("host", "task-1");
        expect(leaks(reviewerProfiles)).toEqual({ ...ALL_LEAKS, venueAddress: false });
    });
});
