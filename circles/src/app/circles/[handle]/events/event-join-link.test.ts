// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/event-join-link.test.ts"
// Leak round 3, M1, Tim's decision D1 (2026-11-07): an online event's join link (virtualUrl) went
// to everyone who could see the event, whatever its access mode. Now, for events whose access mode
// isn't open RSVP, only the event's managers and its invitees (not declined) get it: on the event
// page, the logged-out page, the map and list, and in both calendar (ICS) files. Open-RSVP events
// are unchanged. The database is in-memory fakes; the session and permission checks are stubbed.

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
        if (feature === features.events.view) return true;
        if (feature === features.events.moderate) return !!did && moderators.has(did);
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getEventAction } = await import("./actions");
const { getPublicEventByIdForCircle, getOpenEventsForList, getOpenEventsForMap } = await import("@/lib/data/event");
const { GET: eventIcs } = await import("./[eventId]/ics/route");
const { GET: feedIcs } = await import("./ics/route");

const HOST_ID = "64f600000000000000000001";
const GATED_ID = "64f6000000000000000000e1";
const OPEN_ID = "64f6000000000000000000e2";
const AUTHOR = "did:test:author";
const MODERATOR = "did:test:moderator";
const INVITEE = "did:test:invitee";
const DECLINED = "did:test:declined";
const STRANGER = "did:test:stranger";

const GATED_LINK = "https://meet.example.invalid/canary-gated";
const OPEN_LINK = "https://meet.example.invalid/open";

const future = (days: number) => new Date(Date.now() + days * 86_400_000);
const event = (id: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(id),
    circleId: HOST_ID,
    stage: "open",
    visibility: "public",
    createdBy: AUTHOR,
    startAt: future(3),
    endAt: future(4),
    userGroups: ["everyone"],
    isVirtual: true,
    ...extra,
});
const stored = () => [
    event(GATED_ID, {
        title: "Approval-only stream",
        virtualUrl: GATED_LINK,
        metadata: { peerify: { accessMode: "approval_required" } },
    }),
    event(OPEN_ID, { title: "Open stream", virtualUrl: OPEN_LINK }),
];

beforeEach(() => {
    sessionDid = undefined;
    moderators.clear();
    moderators.add(MODERATOR);
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(HOST_ID), did: "did:test:host", handle: "host", name: "Host", circleType: "circle", publishStatus: "published" },
        ],
        Events: stored(),
        EventInvitations: [
            { eventId: GATED_ID, userDid: INVITEE, status: "pending" },
            { eventId: GATED_ID, userDid: DECLINED, status: "declined" },
        ],
    });
    fakeDb.setAggregateResult("Events", stored(), { applyLeadingMatch: true });
});

const linkOf = async (eventId: string) => (await getEventAction("host", eventId))?.virtualUrl;
const feed = async () =>
    (await feedIcs(new Request("http://localhost/circles/host/events/ics"), { params: Promise.resolve({ handle: "host" }) })).text();
const single = async (eventId: string) =>
    (
        await eventIcs(new Request(`http://localhost/circles/host/events/${eventId}/ics`), {
            params: Promise.resolve({ handle: "host", eventId }),
        })
    ).text();

describe("event page", () => {
    test("a signed-in stranger and a declined invitee: no join link for the approval-only event", async () => {
        for (const did of [STRANGER, DECLINED]) {
            sessionDid = did;
            expect(await linkOf(GATED_ID)).toBeUndefined();
            expect(await linkOf(OPEN_ID)).toBe(OPEN_LINK); // open RSVP unchanged
        }
    });

    test("an invitee, the author and a moderator get it", async () => {
        for (const did of [INVITEE, AUTHOR, MODERATOR]) {
            sessionDid = did;
            expect(await linkOf(GATED_ID)).toBe(GATED_LINK);
        }
    });

    test("logged out: no gated link, the open one stays", async () => {
        expect((await getPublicEventByIdForCircle(HOST_ID, GATED_ID))?.virtualUrl).toBeUndefined();
        expect((await getPublicEventByIdForCircle(HOST_ID, OPEN_ID))?.virtualUrl).toBe(OPEN_LINK);
    });
});

describe("map and list", () => {
    test("no gated link for a stranger; the open one stays", async () => {
        for (const list of [await getOpenEventsForList(STRANGER), await getOpenEventsForMap(STRANGER)]) {
            expect(JSON.stringify(list)).not.toContain(GATED_LINK);
            expect(JSON.stringify(list)).toContain(OPEN_LINK);
        }
    });
});

describe("calendar files", () => {
    test("a stranger: the gated event without its link", async () => {
        sessionDid = STRANGER;
        for (const body of [await feed(), await single(GATED_ID)]) {
            expect(body).toContain("Approval-only stream");
            expect(body).not.toContain(GATED_LINK);
        }
        expect(await feed()).toContain(OPEN_LINK);
    });

    test("an invitee and a moderator get the link", async () => {
        for (const did of [INVITEE, MODERATOR]) {
            sessionDid = did;
            expect(await feed()).toContain(GATED_LINK);
            expect(await single(GATED_ID)).toContain(GATED_LINK);
        }
    });
});
