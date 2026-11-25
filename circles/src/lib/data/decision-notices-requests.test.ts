// Run: IS_BUILD=true bun test src/lib/data/decision-notices-requests.test.ts
// Crew polish (2026-11-25): Crew applications, follow requests and contact requests stand out as
// "action needed" in the bell until they're handled, worked out on load like task claims:
//  - crew_application / follow_request: the person (content.user.did) still has a pending
//    application / follow request to that circle (content.circle._id);
//  - contact_request_received: no resolution on the notice yet.
// Follow requests also get a Review button (they had a link but no label).
// The last block runs listNotificationsForUser on in-memory fakes (testing/fake-db.ts).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { emptyNoticeFacts, getNoticeAction, getNoticeLookups, type NoticeFacts } from "./notification-action-state";
import { getActionNeededReminder, getNotificationActionLabel } from "@/components/layout/notification-actions";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE = "64a000000000000000000d01";
const OTHER_CIRCLE = "64a000000000000000000d02";
const ADMIN = "did:test:admin";
const FAN = "did:test:fan";
const OTHER_FAN = "did:test:other-fan";

const facts = (partial: Partial<NoticeFacts>): NoticeFacts => ({ ...emptyNoticeFacts(), ...partial });
const requestNotice = (type: string, userDid = FAN, circleId = CIRCLE) => ({
    type,
    content: { circle: { _id: circleId, handle: "artist" }, user: { did: userDid, name: "Fan" } },
});

describe("crew_application", () => {
    const pending = facts({ pendingCrewApplications: [{ circleId: CIRCLE, userDid: FAN }] });

    test("pending: needed", () => {
        expect(getNoticeAction(requestNotice("crew_application"), pending, ADMIN)).toEqual({ needed: true });
    });

    test("approved or rejected (no pending row): not needed", () => {
        expect(getNoticeAction(requestNotice("crew_application"), emptyNoticeFacts(), ADMIN)).toEqual({
            needed: false,
        });
    });

    test("another person's or another circle's pending application doesn't count", () => {
        expect(getNoticeAction(requestNotice("crew_application", OTHER_FAN), pending, ADMIN)).toEqual({
            needed: false,
        });
        expect(getNoticeAction(requestNotice("crew_application", FAN, OTHER_CIRCLE), pending, ADMIN)).toEqual({
            needed: false,
        });
    });

    test("a pending follow request isn't a Crew application", () => {
        const follow = facts({ pendingMembershipRequests: [{ circleId: CIRCLE, userDid: FAN }] });
        expect(getNoticeAction(requestNotice("crew_application"), follow, ADMIN)).toEqual({ needed: false });
    });

    test("an old notice without the circle: not needed (never a wrong amber)", () => {
        const notice = { type: "crew_application", content: { user: { did: FAN } } };
        expect(getNoticeAction(notice, pending, ADMIN)).toEqual({ needed: false });
    });
});

describe("follow_request", () => {
    const pending = facts({ pendingMembershipRequests: [{ circleId: CIRCLE, userDid: FAN }] });

    test("pending: needed; handled: not", () => {
        expect(getNoticeAction(requestNotice("follow_request"), pending, ADMIN)).toEqual({ needed: true });
        expect(getNoticeAction(requestNotice("follow_request"), emptyNoticeFacts(), ADMIN)).toEqual({ needed: false });
    });

    test("now has a Review button, and its own reminder line", () => {
        expect(getNotificationActionLabel("follow_request", "/circles/artist/settings/membership-requests")).toBe(
            "Review",
        );
        expect(getActionNeededReminder("follow_request", { needed: true })).toBe(
            "Action needed: approve or decline this follow request",
        );
    });
});

describe("contact_request_received", () => {
    test("no resolution: needed; accepted, declined or withdrawn: not", () => {
        const notice = { type: "contact_request_received", content: { user: { did: FAN } } };
        expect(getNoticeAction(notice, emptyNoticeFacts(), ADMIN)).toEqual({ needed: true });
        for (const resolution of ["accepted", "declined", "withdrawn"]) {
            expect(getNoticeAction({ ...notice, resolution }, emptyNoticeFacts(), ADMIN)).toEqual({ needed: false });
        }
    });
});

describe("lookups", () => {
    test("one list of circles and people per kind; contact requests need none", () => {
        const lookups = getNoticeLookups([
            requestNotice("crew_application"),
            requestNotice("crew_application", OTHER_FAN),
            requestNotice("follow_request", FAN, OTHER_CIRCLE),
            { type: "contact_request_received", content: { user: { did: FAN } } },
        ]);
        expect(lookups.crewApplications).toEqual({ circleIds: [CIRCLE], userDids: [FAN, OTHER_FAN] });
        expect(lookups.membershipRequests).toEqual({ circleIds: [OTHER_CIRCLE], userDids: [FAN] });
        expect(lookups.taskIds).toEqual([]);
    });
});

const { listNotificationsForUser } = await import("./notifications");

describe("listNotificationsForUser", () => {
    const stored = (type: string, content: object, extra: object = {}) => ({
        _id: new ObjectId(),
        userId: ADMIN,
        type,
        content,
        isRead: false,
        createdAt: new Date(),
        ...extra,
    });

    beforeEach(() => {
        fakeDb.reset({
            CrewApplications: [
                { _id: new ObjectId(), userDid: FAN, circleId: CIRCLE, status: "pending", requestedAt: new Date() },
                {
                    _id: new ObjectId(),
                    userDid: OTHER_FAN,
                    circleId: CIRCLE,
                    status: "approved",
                    requestedAt: new Date(),
                },
            ],
            MembershipRequests: [
                { _id: new ObjectId(), userDid: FAN, circleId: CIRCLE, status: "rejected", requestedAt: new Date() },
            ],
            Notifications: [
                stored("crew_application", requestNotice("crew_application").content),
                stored("crew_application", requestNotice("crew_application", OTHER_FAN).content),
                stored("follow_request", requestNotice("follow_request").content),
                stored("contact_request_received", { user: { did: OTHER_FAN } }, { resolution: "accepted" }),
                stored("post_like", {}),
            ],
        });
    });

    test("each notice gets its state from the stored records; nothing else is added", async () => {
        const notices = (await listNotificationsForUser(ADMIN, 50)) as any[];
        const byKey = (type: string, did?: string) =>
            notices.find((n) => n.type === type && (!did || n.content?.user?.did === did));

        expect(byKey("crew_application", FAN).action).toEqual({ needed: true });
        expect(byKey("crew_application", OTHER_FAN).action).toEqual({ needed: false });
        expect(byKey("follow_request").action).toEqual({ needed: false });
        expect(byKey("contact_request_received").action).toEqual({ needed: false });
        expect(byKey("post_like").action).toBeUndefined();
        expect(JSON.stringify(notices)).not.toContain("requestedAt");
    });
});
