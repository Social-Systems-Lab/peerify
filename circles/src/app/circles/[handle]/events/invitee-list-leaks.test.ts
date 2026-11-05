// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/invitee-list-leaks.test.ts"
// Leak round 3, H3 (2026-11-05): getInvitedUsersAction checked events.view on the URL circle and then
// returned every invitee of whatever eventId it was given: another circle's event (private ones
// included), or an event the viewer doesn't manage. Now the event must belong to the URL circle and be
// one the viewer can open (getEventById), and only its managers (canManageEvent) see the whole list;
// an invitee sees only themself. The database is in-memory fakes and the session/permissions are stubbed.

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

const { getInvitedUsersAction } = await import("./actions");

const HOST_ID = "64b000000000000000000001";
const STRANGER_CIRCLE_ID = "64b000000000000000000002";
const EVENT_ID = "64b0000000000000000000e1";
const AUTHOR = "did:test:author";
const STRANGER = "did:test:stranger";
const MODERATOR = "did:test:moderator";
const INVITEE_A = "did:test:canary-invitee-a";
const INVITEE_B = "did:test:canary-invitee-b";

const userCircle = (did: string, handle: string) => ({
    _id: new ObjectId(),
    did,
    handle,
    name: handle,
    circleType: "user",
});

beforeEach(() => {
    sessionDid = undefined;
    moderators.clear();
    moderators.add(MODERATOR);
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(HOST_ID), did: "did:test:host", handle: "host", name: "Host", circleType: "circle" },
            { ...userCircle(STRANGER, "stranger"), _id: new ObjectId(STRANGER_CIRCLE_ID) },
            userCircle(AUTHOR, "author"),
            userCircle(INVITEE_A, "invitee-a"),
            userCircle(INVITEE_B, "invitee-b"),
        ],
        EventInvitations: [
            { eventId: EVENT_ID, userDid: INVITEE_A },
            { eventId: EVENT_ID, userDid: INVITEE_B },
        ],
    });
    // getEventById: a private event hosted by "host".
    fakeDb.setAggregateResult(
        "Events",
        [
            {
                _id: new ObjectId(EVENT_ID),
                circleId: HOST_ID,
                title: "Private house show",
                stage: "open",
                visibility: "private",
                createdBy: AUTHOR,
            },
        ],
        { applyLeadingMatch: true },
    );
});

const dids = (result: { users: { did?: string }[] }) => result.users.map((u) => u.did).sort();

describe("getInvitedUsersAction", () => {
    test("a stranger, through their own handle: another circle's event gives nothing", async () => {
        sessionDid = STRANGER;
        expect(dids(await getInvitedUsersAction("stranger", EVENT_ID))).toEqual([]);
    });

    test("a stranger, through the host's handle: not a manager, so no invitee list", async () => {
        sessionDid = STRANGER;
        expect(dids(await getInvitedUsersAction("host", EVENT_ID))).toEqual([]);
    });

    test("an invitee sees only themself", async () => {
        sessionDid = INVITEE_A;
        expect(dids(await getInvitedUsersAction("host", EVENT_ID))).toEqual([INVITEE_A]);
    });

    test("the author still sees every invitee", async () => {
        sessionDid = AUTHOR;
        expect(dids(await getInvitedUsersAction("host", EVENT_ID))).toEqual([INVITEE_A, INVITEE_B]);
    });

    test("an events moderator of the host still sees every invitee", async () => {
        sessionDid = MODERATOR;
        expect(dids(await getInvitedUsersAction("host", EVENT_ID))).toEqual([INVITEE_A, INVITEE_B]);
    });

    test("logged out: nothing", async () => {
        expect(dids(await getInvitedUsersAction("host", EVENT_ID))).toEqual([]);
    });
});
