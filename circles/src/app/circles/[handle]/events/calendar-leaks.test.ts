// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/calendar-leaks.test.ts"
// Leak round 3, H4 (2026-11-05): the calendar (ICS) routes. The circle feed dropped the "not private"
// filter for every signed-in viewer, and the single-event file blocked private events only when
// logged out, so any signed-in user with events.view got a private event's title, description, time
// and online link. Neither looked at the event's audience (userGroups). Now a private event is only
// for its managers, invitees, people who RSVPed and admins of a listed artist circle, and the audience
// is respected (filterEventsForCalendar). The database is in-memory fakes; session/permissions stubbed.

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

const { GET: eventIcs } = await import("./[eventId]/ics/route");
const { GET: feedIcs } = await import("./ics/route");

const HOST_ID = "64c000000000000000000001";
const PUBLIC_ID = "64c0000000000000000000e1";
const PRIVATE_ID = "64c0000000000000000000e2";
const CREW_ID = "64c0000000000000000000e3";
const AUTHOR = "did:test:author";
const STRANGER = "did:test:stranger";
const INVITEE = "did:test:invitee";
const RSVPER = "did:test:rsvper";
const CREW_MEMBER = "did:test:crew";
const MODERATOR = "did:test:moderator";

const PRIVATE_TITLE = "CANARY PRIVATE HOUSE SHOW";
const PRIVATE_LINK = "https://meet.example.invalid/canary-private";
const CREW_TITLE = "CANARY CREW REHEARSAL";

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
    location: { precision: 2, city: "Stockholm", country: "Sweden" },
    ...extra,
});

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
        Events: [
            event(PUBLIC_ID),
            event(PRIVATE_ID, {
                title: PRIVATE_TITLE,
                visibility: "private",
                isVirtual: true,
                virtualUrl: PRIVATE_LINK,
            }),
            event(CREW_ID, { title: CREW_TITLE, userGroups: ["crew"] }),
        ],
        EventInvitations: [{ eventId: PRIVATE_ID, userDid: INVITEE }],
        EventRsvps: [{ eventId: PRIVATE_ID, userDid: RSVPER, status: "going" }],
    });
});

const feed = async () =>
    (await feedIcs(new Request("http://localhost/circles/host/events/ics"), {
        params: Promise.resolve({ handle: "host" }),
    })).text();
const single = (eventId: string) =>
    eventIcs(new Request(`http://localhost/circles/host/events/${eventId}/ics`), {
        params: Promise.resolve({ handle: "host", eventId }),
    });

describe("circle events ICS feed", () => {
    test("a signed-in stranger: no private event, no crew-only event", async () => {
        sessionDid = STRANGER;
        const body = await feed();
        expect(body).toContain("Public gig");
        expect(body).not.toContain(PRIVATE_TITLE);
        expect(body).not.toContain(PRIVATE_LINK);
        expect(body).not.toContain(CREW_TITLE);
    });

    test("an invitee and someone who RSVPed get the private event", async () => {
        for (const did of [INVITEE, RSVPER]) {
            sessionDid = did;
            expect(await feed()).toContain(PRIVATE_TITLE);
        }
    });

    test("a crew member gets the crew-only event", async () => {
        sessionDid = CREW_MEMBER;
        expect(await feed()).toContain(CREW_TITLE);
    });

    test("the author and a moderator get everything", async () => {
        for (const did of [AUTHOR, MODERATOR]) {
            sessionDid = did;
            const body = await feed();
            expect(body).toContain(PRIVATE_TITLE);
            expect(body).toContain(CREW_TITLE);
        }
    });

    test("logged out: the public event only", async () => {
        const body = await feed();
        expect(body).toContain("Public gig");
        expect(body).not.toContain(PRIVATE_TITLE);
        expect(body).not.toContain(CREW_TITLE);
    });
});

describe("single event ICS", () => {
    test("a signed-in stranger gets 404 for the private and the crew-only event", async () => {
        sessionDid = STRANGER;
        expect((await single(PRIVATE_ID)).status).toBe(404);
        expect((await single(CREW_ID)).status).toBe(404);
        expect((await single(PUBLIC_ID)).status).toBe(200);
    });

    test("the invitee gets the private event, with its link", async () => {
        sessionDid = INVITEE;
        const response = await single(PRIVATE_ID);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain(PRIVATE_LINK);
    });

    test("the author and a moderator still get both", async () => {
        for (const did of [AUTHOR, MODERATOR]) {
            sessionDid = did;
            expect((await single(PRIVATE_ID)).status).toBe(200);
            expect((await single(CREW_ID)).status).toBe(200);
        }
    });
});
