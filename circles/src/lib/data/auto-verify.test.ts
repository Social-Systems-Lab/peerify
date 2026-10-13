// Run: bun test src/lib/data/auto-verify.test.ts
// autoVerifyUserIfReady (circle.ts) with the database and readiness check mocked: a complete
// profile only auto-verifies once the email address is verified.

import { readFileSync } from "fs";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeCollection, type FakeCollection } from "@/lib/testing/fake-collection";

const USER_ID = "65f0a0a0a0a0a0a0a0a0a0a1";
let circles: FakeCollection = createFakeCollection();
let ready = true;
const notified: string[] = [];

const collectionProxy = {
    findOne: (...args: Parameters<FakeCollection["findOne"]>) => circles.findOne(...args),
    updateOne: (...args: Parameters<FakeCollection["updateOne"]>) => circles.updateOne(...args),
    createIndex: async () => "",
};
const DB_EXPORTS =
    "client db ServerSettingsCollection Members MembershipRequests CrewApplications AdminInvitations Feeds Posts Comments Reactions Skills Sdgs ChatRooms ChatMessages ChatRoomMembers Challenges Proposals Issues Tasks Tracks FundingAsks Goals Events EventRsvps EventInvitations EventHostChangeRequests GoalMembers RankedLists AggregateRanks UserNotificationSettings DefaultNotificationSettings Notifications PushSubscriptions ChatConversations ChatMessageDocs ChatReadStates MessageEmailReminders PlatformBroadcastMessages StripeWebhookEvents UserRelationships HumanityVerifications PlatformSettingsCollection RateLimits";
mock.module("@/lib/data/db", () => ({
    ...Object.fromEntries(DB_EXPORTS.split(" ").map((name) => [name, collectionProxy])),
    Circles: collectionProxy,
    getDb: async () => ({}),
}));
const readiness = await import("@/lib/verification-readiness");
mock.module("@/lib/verification-readiness", () => ({
    ...readiness,
    getVerificationReadiness: () => ({ isReady: ready, items: [] }),
}));
// Modules circle.ts loads import many names from these; stub every export.
const exportNames = (file: string) =>
    [...readFileSync(new URL(file, import.meta.url), "utf8").matchAll(/^export (?:const|async function|function) (\w+)/gm)].map(
        (m) => m[1],
    );
const stubAll = (file: string) => Object.fromEntries(exportNames(file).map((name) => [name, async () => undefined]));
const notificationExports = exportNames("./notifications.ts");
mock.module("@/lib/data/notifications", () => ({
    ...Object.fromEntries(notificationExports.map((name) => [name, async () => undefined])),
    sendUserVerifiedNotification: async (c: { did?: string }) => {
        notified.push(String(c.did));
    },
}));
mock.module("@/lib/data/vdb", () => stubAll("./vdb.ts"));

const { autoVerifyUserIfReady } = await import("./circle");

const seed = (overrides: Record<string, unknown>) => {
    circles = createFakeCollection([
        { _id: new ObjectId(USER_ID), did: "did-1", circleType: "user", isVerified: false, accountStatus: "pending_verification", ...overrides },
    ]);
};

describe("autoVerifyUserIfReady", () => {
    beforeEach(() => {
        ready = true;
        notified.length = 0;
    });

    test("complete profile + unverified email: stays pending", async () => {
        seed({ isEmailVerified: false });
        const returned = await autoVerifyUserIfReady(USER_ID);
        // The profile was found (so the email check is what stopped it).
        expect(returned?.did).toBe("did-1");
        expect(circles.docs[0].isVerified).toBe(false);
        expect(circles.docs[0].accountStatus).toBe("pending_verification");
        expect(notified).toEqual([]);
    });

    test("complete profile + missing isEmailVerified field: stays pending", async () => {
        seed({});
        await autoVerifyUserIfReady(USER_ID);
        expect(circles.docs[0].accountStatus).toBe("pending_verification");
    });

    test("complete profile + verified email: verified, active, notified", async () => {
        seed({ isEmailVerified: true });
        await autoVerifyUserIfReady(USER_ID);
        expect(circles.docs[0].isVerified).toBe(true);
        expect(circles.docs[0].accountStatus).toBe("active");
        expect(notified).toEqual(["did-1"]);
    });

    test("verified email but incomplete profile: stays pending", async () => {
        ready = false;
        seed({ isEmailVerified: true });
        await autoVerifyUserIfReady(USER_ID);
        expect(circles.docs[0].accountStatus).toBe("pending_verification");
    });

    test("already verified: nothing changes, no second notification", async () => {
        seed({ isEmailVerified: true, isVerified: true, accountStatus: "active" });
        await autoVerifyUserIfReady(USER_ID);
        expect(notified).toEqual([]);
    });
});
