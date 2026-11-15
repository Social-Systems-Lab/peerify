// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/event-author-leaks.test.ts"
// Event author identity (Tim's decision on D, 2026-11-15). An event is saved under the personal
// account that made it, and every event the app sent carried that account: createdBy (its DID) and
// author (name, handle, picture, DID), to every visitor, signed out too. The page didn't show it,
// but the page data did, so a venue run from a personal account named its owner. Now only the
// event's managers get them. Checked here: the event page, the events list (signed in and out), the
// map and list across circles, and the ICS files (which never had them). The database is in-memory
// fakes; session and permission checks are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const moderators = new Set<string>();
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, _circleId: string, feature: unknown) => {
        if (feature === features.events.view) return true; // the venue's events are public
        if (feature === features.events.moderate) return !!did && moderators.has(did);
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getEventAction, getEventsAction } = await import("./actions");
const { getPublicEventsByCircleId, getOpenEventsForList, getOpenEventsForMap } = await import("@/lib/data/event");
const { GET: eventIcs } = await import("./[eventId]/ics/route");
const { GET: feedIcs } = await import("./ics/route");

const HOST_ID = "64e000000000000000000001";
const EVENT_ID = "64e0000000000000000000e1";
const OWNER = "did:test:canary-owner";
const OWNER_NAME = "Canary Owner Name";
const OWNER_HANDLE = "canary-owner-handle";
const OWNER_PICTURE = "https://storage.example.invalid/canary-owner.jpg";
const STRANGER = "did:test:stranger";
const CREW_MEMBER = "did:test:crew";
const MODERATOR = "did:test:moderator";

const future = (days: number) => new Date(Date.now() + days * 86_400_000);
// What the event aggregates return: the stored event plus the author $lookup.
const stored = () => [
    {
        _id: new ObjectId(EVENT_ID),
        circleId: HOST_ID,
        title: "Julian Wenn, house concert",
        stage: "open",
        visibility: "public",
        createdBy: OWNER,
        author: { _id: "64e000000000000000000009", did: OWNER, name: OWNER_NAME, handle: OWNER_HANDLE, picture: { url: OWNER_PICTURE } },
        circle: { _id: HOST_ID, name: "The Venue", handle: "venue", publishStatus: "published", circleType: "circle" },
        startAt: future(3),
        endAt: future(4),
        userGroups: ["everyone"],
        location: { precision: 2, city: "Stockholm", country: "Sweden", lngLat: { lng: 18.07, lat: 59.33 } },
    },
];

const owner = (value: unknown) => {
    const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
    return {
        did: text.includes(OWNER),
        name: text.includes(OWNER_NAME),
        handle: text.includes(OWNER_HANDLE),
        picture: text.includes(OWNER_PICTURE),
    };
};
const NOTHING = { did: false, name: false, handle: false, picture: false };

beforeEach(() => {
    sessionDid = undefined;
    moderators.clear();
    moderators.add(MODERATOR);
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(HOST_ID),
                did: "did:test:venue",
                handle: "venue",
                name: "The Venue",
                circleType: "circle",
                publishStatus: "published",
            },
        ],
        Members: [
            { userDid: OWNER, circleId: HOST_ID, userGroups: ["admins", "moderators", "members"] },
            { userDid: STRANGER, circleId: HOST_ID, userGroups: ["members"] },
            { userDid: CREW_MEMBER, circleId: HOST_ID, userGroups: ["members", "crew"] },
        ],
        Events: stored(),
    });
    fakeDb.setAggregateResult("Events", stored(), { applyLeadingMatch: true });
});

const VISITORS: [string, string | undefined][] = [
    ["signed out", undefined],
    ["a signed-in follower", STRANGER],
    ["a crew member", CREW_MEMBER],
];

describe("event page (getEventAction)", () => {
    for (const [who, did] of VISITORS) {
        test(`${who}: the event, without the author's DID, name, handle or picture`, async () => {
            sessionDid = did;
            const event = await getEventAction("venue", EVENT_ID);
            expect(event?.title).toBe("Julian Wenn, house concert");
            expect(owner(event)).toEqual(NOTHING);
            expect(Object.keys(event ?? {})).not.toContain("createdBy");
            expect(Object.keys(event ?? {})).not.toContain("author");
        });
    }

    test("the author and a moderator still get createdBy and author (the edit and manage screens)", async () => {
        moderators.add(OWNER);
        for (const did of [OWNER, MODERATOR]) {
            sessionDid = did;
            const event = await getEventAction("venue", EVENT_ID);
            expect(event?.createdBy).toBe(OWNER);
            expect(event?.author?.name).toBe(OWNER_NAME);
        }
    });
});

describe("events list", () => {
    test("signed in (getEventsAction): no author for a follower or a crew member", async () => {
        for (const did of [STRANGER, CREW_MEMBER]) {
            sessionDid = did;
            const { events } = await getEventsAction("venue");
            expect(events.map((e) => e.title)).toEqual(["Julian Wenn, house concert"]);
            expect(owner(events)).toEqual(NOTHING);
        }
    });

    test("signed in (getEventsAction): the author keeps createdBy", async () => {
        sessionDid = OWNER;
        const { events } = await getEventsAction("venue");
        expect(events[0]?.createdBy).toBe(OWNER);
    });

    test("signed out (getPublicEventsByCircleId): no author", async () => {
        const events = await getPublicEventsByCircleId(HOST_ID);
        expect(events.map((e) => e.title)).toEqual(["Julian Wenn, house concert"]);
        expect(owner(events)).toEqual(NOTHING);
    });
});

describe("map and list across circles", () => {
    test("no author, signed out, for a follower or for a crew member", async () => {
        for (const did of ["", STRANGER, CREW_MEMBER]) {
            const map = await getOpenEventsForMap(did);
            expect(map.map((e) => e.title)).toEqual(["Julian Wenn, house concert"]);
            expect(owner(map)).toEqual(NOTHING);
            if (did) {
                const list = await getOpenEventsForList(did);
                expect(list.map((e) => e.title)).toEqual(["Julian Wenn, house concert"]);
                expect(owner(list)).toEqual(NOTHING);
            }
        }
    });
});

describe("ICS", () => {
    test("neither the event file nor the circle feed names the author", async () => {
        for (const did of [undefined, STRANGER, CREW_MEMBER]) {
            sessionDid = did;
            const single = await (
                await eventIcs(new Request(`http://localhost/circles/venue/events/${EVENT_ID}/ics`), {
                    params: Promise.resolve({ handle: "venue", eventId: EVENT_ID }),
                })
            ).text();
            const feed = await (
                await feedIcs(new Request("http://localhost/circles/venue/events/ics"), {
                    params: Promise.resolve({ handle: "venue" }),
                })
            ).text();
            expect(single).toContain("Julian Wenn");
            expect(feed).toContain("Julian Wenn");
            expect(owner(single)).toEqual(NOTHING);
            expect(owner(feed)).toEqual(NOTHING);
        }
    });
});
