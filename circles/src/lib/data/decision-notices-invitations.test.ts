// Run: IS_BUILD=true bun test src/lib/data/decision-notices-invitations.test.ts
// Crew polish (2026-11-25): admin invitations, event host-change requests and event invitations stand
// out as "action needed" in the bell until they're handled, worked out on load:
//  - admin_invitation_received: the invitation (content.invitationId) is still pending; older notices
//    without the id: a pending invitation to that circle for the recipient;
//  - event_host_change_requested: the event's host-change request is still pending;
//  - event_invitation: no RSVP yet (any status), on an event that's open and hasn't started. The
//    invitation's own status is never updated after it's sent, so it can't be used.
// Event invitations also get an RSVP button (they had a link but no label).
// The last block runs listNotificationsForUser on in-memory fakes (testing/fake-db.ts).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { emptyNoticeFacts, getNoticeAction, getNoticeLookups, type NoticeFacts } from "./notification-action-state";
import { getActionNeededReminder, getNotificationActionLabel } from "@/components/layout/notification-actions";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE = "64a000000000000000000e01";
const INVITATION = "64a000000000000000000e11";
const OTHER_INVITATION = "64a000000000000000000e12";
const EVENT = "64a000000000000000000e21";
const OTHER_EVENT = "64a000000000000000000e22";
const GUEST = "did:test:guest";
const OTHER = "did:test:other";
const NOW = new Date("2026-12-01T12:00:00Z");
const LATER = new Date("2026-12-06T18:00:00Z");
const EARLIER = new Date("2026-11-28T18:00:00Z");

const facts = (partial: Partial<NoticeFacts>): NoticeFacts => ({ ...emptyNoticeFacts(NOW), ...partial });
const pendingInvitation = { _id: INVITATION, circleId: CIRCLE, invitedUserDid: GUEST };

describe("admin_invitation_received", () => {
    const notice = {
        type: "admin_invitation_received",
        content: { circle: { _id: CIRCLE }, invitationId: INVITATION },
    };

    test("pending: needed; accepted, declined or cancelled (not pending): not", () => {
        expect(getNoticeAction(notice, facts({ pendingAdminInvitations: [pendingInvitation] }), GUEST)).toEqual({
            needed: true,
        });
        expect(getNoticeAction(notice, facts({}), GUEST)).toEqual({ needed: false });
    });

    test("with an invitationId, only that invitation counts (another pending one to the same circle doesn't)", () => {
        const other = { ...pendingInvitation, _id: OTHER_INVITATION };
        expect(getNoticeAction(notice, facts({ pendingAdminInvitations: [other] }), GUEST)).toEqual({ needed: false });
    });

    test("older notice without invitationId: a pending invitation to that circle for the recipient", () => {
        const old = { type: "admin_invitation_received", content: { circle: { _id: CIRCLE } } };
        expect(getNoticeAction(old, facts({ pendingAdminInvitations: [pendingInvitation] }), GUEST)).toEqual({
            needed: true,
        });
        expect(getNoticeAction(old, facts({ pendingAdminInvitations: [pendingInvitation] }), OTHER)).toEqual({
            needed: false,
        });
    });
});

describe("event_host_change_requested", () => {
    const notice = { type: "event_host_change_requested", content: { eventId: EVENT } };

    test("pending: needed; decided: not", () => {
        expect(getNoticeAction(notice, facts({ pendingHostChangeEventIds: [EVENT] }), OTHER)).toEqual({ needed: true });
        expect(getNoticeAction(notice, facts({ pendingHostChangeEventIds: [OTHER_EVENT] }), OTHER)).toEqual({
            needed: false,
        });
    });
});

describe("event_invitation", () => {
    const notice = { type: "event_invitation", content: { eventId: EVENT } };
    const openLater = { _id: EVENT, stage: "open", startAt: LATER };

    test("open, upcoming, no RSVP: needed", () => {
        expect(getNoticeAction(notice, facts({ events: [openLater] }), GUEST)).toEqual({ needed: true });
    });

    test("answered (any RSVP status): not needed", () => {
        expect(getNoticeAction(notice, facts({ events: [openLater], rsvpEventIds: [EVENT] }), GUEST)).toEqual({
            needed: false,
        });
    });

    test("an RSVP to another event doesn't count", () => {
        expect(getNoticeAction(notice, facts({ events: [openLater], rsvpEventIds: [OTHER_EVENT] }), GUEST)).toEqual({
            needed: true,
        });
    });

    test("started, cancelled, still a draft, or gone: not needed", () => {
        for (const event of [
            { ...openLater, startAt: EARLIER },
            { ...openLater, stage: "cancelled" },
            { ...openLater, stage: "draft" },
        ]) {
            expect(getNoticeAction(notice, facts({ events: [event] }), GUEST)).toEqual({ needed: false });
        }
        expect(getNoticeAction(notice, facts({}), GUEST)).toEqual({ needed: false });
    });

    test("now has an RSVP button, and its own reminder line", () => {
        expect(getNotificationActionLabel("event_invitation", `/circles/a/events/${EVENT}`)).toBe("RSVP");
        expect(getActionNeededReminder("event_invitation", { needed: true })).toBe(
            "Action needed: let them know if you're coming",
        );
    });
});

describe("lookups", () => {
    test("invitations by id or (older) by circle; events and host changes by event id", () => {
        const lookups = getNoticeLookups([
            { type: "admin_invitation_received", content: { circle: { _id: CIRCLE }, invitationId: INVITATION } },
            { type: "admin_invitation_received", content: { circle: { _id: "c-old" } } },
            { type: "event_host_change_requested", content: { eventId: EVENT } },
            { type: "event_invitation", content: { eventId: OTHER_EVENT } },
            { type: "event_invitation", content: { eventId: "not-an-id" } },
        ]);
        expect(lookups.adminInvitationIds).toEqual([INVITATION]);
        expect(lookups.adminInvitationCircleIds).toEqual(["c-old"]);
        expect(lookups.hostChangeEventIds).toEqual([EVENT]);
        expect(lookups.invitationEventIds).toEqual([OTHER_EVENT]);
    });
});

const { listNotificationsForUser } = await import("./notifications");

describe("listNotificationsForUser", () => {
    const stored = (type: string, content: object) => ({
        _id: new ObjectId(),
        userId: GUEST,
        type,
        content,
        isRead: false,
        createdAt: new Date(),
    });
    const upcoming = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    beforeEach(() => {
        fakeDb.reset({
            AdminInvitations: [
                { _id: new ObjectId(INVITATION), circleId: CIRCLE, invitedUserDid: GUEST, status: "pending" },
                { _id: new ObjectId(OTHER_INVITATION), circleId: CIRCLE, invitedUserDid: GUEST, status: "declined" },
            ],
            Events: [
                { _id: new ObjectId(EVENT), title: "Home show", stage: "open", startAt: upcoming, location: "secret" },
                { _id: new ObjectId(OTHER_EVENT), title: "Other", stage: "open", startAt: upcoming },
            ],
            EventRsvps: [{ _id: new ObjectId(), eventId: OTHER_EVENT, userDid: GUEST, status: "going" }],
            Notifications: [
                stored("admin_invitation_received", { circle: { _id: CIRCLE }, invitationId: INVITATION }),
                stored("admin_invitation_received", { circle: { _id: CIRCLE }, invitationId: OTHER_INVITATION }),
                stored("event_invitation", { eventId: EVENT }),
                stored("event_invitation", { eventId: OTHER_EVENT }),
            ],
        });
    });

    test("each notice gets its state from the stored records; nothing else is sent", async () => {
        const notices = (await listNotificationsForUser(GUEST, 50)) as any[];
        const invitation = (id: string) => notices.find((n) => n.content.invitationId === id);
        const eventNotice = (id: string) =>
            notices.find((n) => n.type === "event_invitation" && n.content.eventId === id);

        expect(invitation(INVITATION).action).toEqual({ needed: true });
        expect(invitation(OTHER_INVITATION).action).toEqual({ needed: false });
        expect(eventNotice(EVENT).action).toEqual({ needed: true });
        expect(eventNotice(OTHER_EVENT).action).toEqual({ needed: false });
        expect(JSON.stringify(notices)).not.toContain("secret");
        expect(JSON.stringify(notices)).not.toContain("Home show");
    });
});
