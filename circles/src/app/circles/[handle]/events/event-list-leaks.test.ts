// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/event-list-leaks.test.ts"
// Leak round 3, containment C2 (2026-11-05): the signed-in event list (getEventsAction, and the
// venue home page through shapeEventsForViewer). Before the fix it returned getEventsByCircleId's
// documents unshaped to every signed-in viewer: the hidden street and pin of non-public (home)
// events, the private organiser note, invitee DIDs, drafts and members-only events. The database is
// in-memory fakes (testing/fake-db.ts) and the session/permission checks are stubbed.

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
        if (feature === features.events.view) return !!did; // every signed-in user may view events
        if (feature === features.events.moderate) return !!did && moderators.has(did);
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getEventsAction } = await import("./actions");
const { shapeEventsForViewer } = await import("@/lib/data/event");

const HIDDEN_STREET = "Canary Home Street 3";
const HIDDEN_LNG = 18.071234;
const PUBLIC_STREET = "Public Venue Street 5";
const NOTE = "Canary door code 4711";
const INVITEE = "did:test:canary-invitee";
const DRAFT_TITLE = "Canary draft gig";
const CREW_TITLE = "Canary crew-only rehearsal";

const HOST_ID = "64a000000000000000000001";
const AUTHOR = "did:test:author";
const STRANGER = "did:test:stranger";
const CREW_MEMBER = "did:test:crew";
const MODERATOR = "did:test:moderator";

const future = (days: number) => new Date(Date.now() + days * 86_400_000);
const event = (id: string, extra: Record<string, unknown> = {}) => ({
    _id: id,
    circleId: HOST_ID,
    title: "Gig",
    stage: "open",
    createdBy: AUTHOR,
    startAt: future(3),
    endAt: future(4),
    userGroups: ["everyone"],
    location: { precision: 4, city: "Stockholm", street: PUBLIC_STREET, lngLat: { lng: 18.1, lat: 59.3 } },
    metadata: { peerify: { locationDisclosure: "public" } },
    ...extra,
});
// What getEventsByCircleId's aggregate returns (SAFE_EVENT_PROJECTION, unshaped).
const listFromDatabase = () => [
    event("e1", { title: "Public gig" }),
    event("e2", {
        title: "House show",
        location: { precision: 4, city: "Stockholm", street: HIDDEN_STREET, lngLat: { lng: HIDDEN_LNG, lat: 59.3 } },
        metadata: { peerify: { locationDisclosure: "approximate", privateLocationNote: NOTE } },
        invitations: [INVITEE],
    }),
    event("e3", { title: DRAFT_TITLE, stage: "draft" }),
    event("e4", { title: CREW_TITLE, userGroups: ["crew"] }),
    event("e5", { title: "Legacy gig", userGroups: [] }),
];

const text = (value: unknown) => JSON.stringify(value) ?? "";
const leaks = (value: unknown) => {
    const t = text(value);
    return {
        hiddenStreet: t.includes(HIDDEN_STREET),
        hiddenPin: t.includes(String(HIDDEN_LNG)),
        note: t.includes(NOTE),
        invitee: t.includes(INVITEE),
        draft: t.includes(DRAFT_TITLE),
        crewOnly: t.includes(CREW_TITLE),
    };
};
const NO_LEAKS = { hiddenStreet: false, hiddenPin: false, note: false, invitee: false, draft: false, crewOnly: false };

beforeEach(() => {
    sessionDid = undefined;
    moderators.clear();
    moderators.add(MODERATOR);
    fakeDb.reset({
        Circles: [{ _id: new ObjectId(HOST_ID), did: "did:test:host", handle: "host", name: "Host", circleType: "circle" }],
        Members: [
            { userDid: STRANGER, circleId: HOST_ID, userGroups: ["members"] },
            { userDid: CREW_MEMBER, circleId: HOST_ID, userGroups: ["members", "crew"] },
        ],
    });
    fakeDb.setAggregateResult("Events", listFromDatabase());
});

describe("getEventsAction (events tab, user toolbox, task form)", () => {
    test("a signed-in stranger: no hidden address, note, invitees, drafts or members-only events", async () => {
        sessionDid = STRANGER;
        const { events } = await getEventsAction("host");

        expect(leaks(events)).toEqual(NO_LEAKS);
        expect(events.map((e) => e.title).sort()).toEqual(["House show", "Legacy gig", "Public gig"]);
        // The public event keeps its address; the home event keeps its city.
        expect(text(events)).toContain(PUBLIC_STREET);
        expect(events.find((e) => e.title === "House show")?.location?.city).toBe("Stockholm");
    });

    test("a member of the event's audience sees the members-only event, still shaped", async () => {
        sessionDid = CREW_MEMBER;
        const { events } = await getEventsAction("host");

        expect(text(events)).toContain(CREW_TITLE);
        expect({ ...leaks(events), crewOnly: false }).toEqual(NO_LEAKS);
    });

    test("the author gets their own events unchanged, the draft included", async () => {
        sessionDid = AUTHOR;
        const { events } = await getEventsAction("host");

        expect(leaks(events)).toEqual({
            hiddenStreet: true,
            hiddenPin: true,
            note: true,
            invitee: true,
            draft: true,
            crewOnly: true,
        });
    });

    test("a moderator of the host circle gets everything unchanged", async () => {
        sessionDid = MODERATOR;
        const { events } = await getEventsAction("host");

        expect(events).toHaveLength(5);
        expect(leaks(events).note).toBe(true);
    });
});

describe("shapeEventsForViewer (venue home page)", () => {
    test("no viewer: the public shape only", async () => {
        const events = await shapeEventsForViewer(listFromDatabase() as any, undefined);

        expect(leaks(events)).toEqual(NO_LEAKS);
        expect(events).toHaveLength(3);
    });
});
