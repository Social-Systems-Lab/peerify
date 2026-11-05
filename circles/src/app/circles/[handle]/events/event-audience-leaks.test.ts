// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/event-audience-leaks.test.ts"
// Leak round 3, H5 (2026-11-05): an event's audience (userGroups, the form's audience picker) was
// enforced only by feed previews and, since C2, the signed-in events list. The event page
// (getEventAction, getEventWithCommentsAction via shapeEventForViewer), the logged-out list and page
// (getPublicEventsByCircleId, getPublicEventByIdForCircle) and the map/list across circles
// (getOpenEventsForMap, getOpenEventsForList) sent a members-only event's title, description, time and
// address to everyone. The ICS routes are covered in calendar-leaks.test.ts (H4). The database is
// in-memory fakes; the session and permission checks are stubbed.

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
        if (feature === features.events.view) return true; // the host's events are public
        if (feature === features.events.moderate) return !!did && moderators.has(did);
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getEventAction } = await import("./actions");
const { getPublicEventsByCircleId, getPublicEventByIdForCircle, getOpenEventsForList, getOpenEventsForMap } =
    await import("@/lib/data/event");

const HOST_ID = "64d000000000000000000001";
const PUBLIC_ID = "64d0000000000000000000e1";
const CREW_ID = "64d0000000000000000000e2";
const DRAFT_ID = "64d0000000000000000000e3";
const LEGACY_ID = "64d0000000000000000000e4";
const AUTHOR = "did:test:author";
const STRANGER = "did:test:stranger";
const CREW_MEMBER = "did:test:crew";
const MODERATOR = "did:test:moderator";

const CREW_TITLE = "CANARY CREW-ONLY REHEARSAL";
const DRAFT_TITLE = "CANARY DRAFT GIG";

const future = (days: number) => new Date(Date.now() + days * 86_400_000);
const event = (id: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(id),
    circleId: HOST_ID,
    title: "Public gig",
    stage: "open",
    visibility: "public",
    createdBy: AUTHOR,
    startAt: future(3),
    endAt: future(4),
    userGroups: ["everyone"],
    location: { precision: 2, city: "Stockholm", country: "Sweden", lngLat: { lng: 18.07, lat: 59.33 } },
    ...extra,
});
const stored = () => [
    event(PUBLIC_ID),
    event(CREW_ID, { title: CREW_TITLE, userGroups: ["crew"] }),
    event(DRAFT_ID, { title: DRAFT_TITLE, stage: "draft" }),
    event(LEGACY_ID, { title: "Legacy gig", userGroups: [] }),
];

beforeEach(() => {
    sessionDid = undefined;
    moderators.clear();
    moderators.add(MODERATOR);
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(HOST_ID),
                did: "did:test:host",
                handle: "host",
                name: "Host",
                circleType: "circle",
                publishStatus: "published",
            },
        ],
        Members: [
            { userDid: STRANGER, circleId: HOST_ID, userGroups: ["members"] },
            { userDid: CREW_MEMBER, circleId: HOST_ID, userGroups: ["members", "crew"] },
        ],
    });
    // Every Events aggregate (getEventById, the public pipeline, map/list) answers from these, with
    // the pipeline's leading $match applied.
    fakeDb.setAggregateResult("Events", stored(), { applyLeadingMatch: true });
});

const titles = (events: { title?: string }[]) => events.map((e) => e.title).sort();

describe("event page (getEventAction)", () => {
    test("a signed-in stranger gets nothing for a crew-only event or a draft", async () => {
        sessionDid = STRANGER;
        expect(await getEventAction("host", CREW_ID)).toBeNull();
        expect(await getEventAction("host", DRAFT_ID)).toBeNull();
        expect((await getEventAction("host", PUBLIC_ID))?.title).toBe("Public gig");
        expect((await getEventAction("host", LEGACY_ID))?.title).toBe("Legacy gig");
    });

    test("a crew member gets the crew-only event", async () => {
        sessionDid = CREW_MEMBER;
        expect((await getEventAction("host", CREW_ID))?.title).toBe(CREW_TITLE);
    });

    test("the author and a moderator get the crew-only event and the draft", async () => {
        for (const did of [AUTHOR, MODERATOR]) {
            sessionDid = did;
            expect((await getEventAction("host", CREW_ID))?.title).toBe(CREW_TITLE);
            expect((await getEventAction("host", DRAFT_ID))?.title).toBe(DRAFT_TITLE);
        }
    });

    test("logged out: the crew-only event isn't served", async () => {
        expect(await getEventAction("host", CREW_ID)).toBeNull();
        expect((await getEventAction("host", PUBLIC_ID))?.title).toBe("Public gig");
    });
});

describe("logged-out list and page", () => {
    test("getPublicEventsByCircleId: open to everyone only", async () => {
        expect(titles(await getPublicEventsByCircleId(HOST_ID))).toEqual(["Legacy gig", "Public gig"]);
    });

    test("getPublicEventByIdForCircle: the crew-only event is not found", async () => {
        expect(await getPublicEventByIdForCircle(HOST_ID, CREW_ID)).toBeNull();
        expect((await getPublicEventByIdForCircle(HOST_ID, PUBLIC_ID))?.title).toBe("Public gig");
    });
});

describe("map and list across circles", () => {
    test("a stranger: no crew-only event", async () => {
        expect(titles(await getOpenEventsForList(STRANGER))).not.toContain(CREW_TITLE);
        expect(titles(await getOpenEventsForMap(STRANGER))).not.toContain(CREW_TITLE);
        expect(titles(await getOpenEventsForList(STRANGER))).toContain("Public gig");
    });

    test("logged out (map): no crew-only event", async () => {
        expect(titles(await getOpenEventsForMap(""))).not.toContain(CREW_TITLE);
    });

    test("a crew member and the author still see it", async () => {
        for (const did of [CREW_MEMBER, AUTHOR]) {
            expect(titles(await getOpenEventsForList(did))).toContain(CREW_TITLE);
            expect(titles(await getOpenEventsForMap(did))).toContain(CREW_TITLE);
        }
    });
});
