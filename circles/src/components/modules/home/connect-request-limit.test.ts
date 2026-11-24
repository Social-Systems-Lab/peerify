// Run: IS_BUILD=true bun test src/components/modules/home/connect-request-limit.test.ts
// Connection requests: at most 20 per sender in a rolling 24 hours (Tim, 2026-11-24), superadmins
// included. Every way of sending one (the limited profile page, the preview, the DM banner) goes
// through sendConnectRequestAction, so the limit lives there. Each request sent stamps requestedAt
// on the sender's edge; a resend inside the decline cooldown stamps it too, so the limit can't be
// used to tell a silent decline apart. Verified senders only, as before. The database is
// in-memory fakes; the session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { sendConnectRequestAction } = await import("./actions");
const { CONNECTION_REQUESTS_PER_DAY } = await import("@/lib/data/relationships");

const SENDER = "did:test:sender";
const SUPERADMIN = "did:test:superadmin";
const UNVERIFIED = "did:test:unverified";
const HOUR = 60 * 60 * 1000;

const person = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: did.split(":").pop(),
    circleType: "user",
    publishStatus: "published",
    isVerified: true,
    ...extra,
});
const targetDid = (n: number) => `did:test:target-${n}`;
const edges = () => fakeDb.col("UserRelationships").docs;
const setEdges = (list: any[]) => {
    const docs = fakeDb.col("UserRelationships").docs;
    docs.splice(0, docs.length, ...list);
};
const notificationCount = () => fakeDb.col("Notifications").docs.length;
const edge = (from: string, to: string) => edges().find((e: any) => e.fromDid === from && e.toDid === to) as any;
// Edges the sender already has, each with a requestedAt `hoursAgo` hours back.
const priorRequests = (from: string, count: number, hoursAgo: number) =>
    Array.from({ length: count }, (_, i) => ({
        _id: new ObjectId(),
        fromDid: from,
        toDid: `did:test:earlier-${i}`,
        connectStatus: "pending_sent",
        requestedAt: new Date(Date.now() - hoursAgo * HOUR),
    }));

beforeEach(() => {
    sessionDid = SENDER;
    fakeDb.reset({
        Circles: [
            person(SENDER),
            person(SUPERADMIN, { isAdmin: true }),
            person(UNVERIFIED, { isVerified: false }),
            ...Array.from({ length: 25 }, (_, i) => person(targetDid(i))),
        ],
        UserRelationships: [],
        Notifications: [],
    });
});

test("the limit is 20", () => {
    expect(CONNECTION_REQUESTS_PER_DAY).toBe(20);
});

describe("20 requests in 24 hours, then refused", () => {
    test("a verified sender: the first 20 go through, the 21st is refused and writes nothing", async () => {
        for (let i = 0; i < 20; i++) {
            const result = await sendConnectRequestAction(targetDid(i));
            expect(result.success).toBe(true);
        }
        const notificationsBefore = notificationCount();
        const refused = await sendConnectRequestAction(targetDid(20));
        expect(refused.success).toBe(false);
        expect(refused.message).toBe("You've sent a lot of connection requests today. Please try again tomorrow.");
        expect(edge(SENDER, targetDid(20))).toBeUndefined();
        expect(edge(targetDid(20), SENDER)).toBeUndefined();
        expect(notificationCount()).toBe(notificationsBefore);
    });

    test("each request sent stamps requestedAt on the sender's edge", async () => {
        const before = Date.now();
        await sendConnectRequestAction(targetDid(0));
        const stamped = edge(SENDER, targetDid(0))?.requestedAt;
        expect(stamped instanceof Date || typeof stamped?.getTime === "function").toBe(true);
        expect(stamped.getTime() >= before).toBe(true);
    });

    test("20 requests within the last 24 hours: refused", async () => {
        setEdges(priorRequests(SENDER, 20, 23));
        const result = await sendConnectRequestAction(targetDid(0));
        expect(result.success).toBe(false);
        expect(edge(SENDER, targetDid(0))).toBeUndefined();
    });

    test("requests older than 24 hours don't count", async () => {
        setEdges(priorRequests(SENDER, 20, 25));
        expect((await sendConnectRequestAction(targetDid(0))).success).toBe(true);
    });

    test("19 in the window: one more goes through", async () => {
        setEdges(priorRequests(SENDER, 19, 1));
        expect((await sendConnectRequestAction(targetDid(0))).success).toBe(true);
        expect((await sendConnectRequestAction(targetDid(1))).success).toBe(false);
    });

    test("a superadmin is limited too", async () => {
        sessionDid = SUPERADMIN;
        // Without the earlier requests, the superadmin can send one.
        expect((await sendConnectRequestAction(targetDid(1))).success).toBe(true);
        setEdges(priorRequests(SUPERADMIN, 20, 1));
        expect((await sendConnectRequestAction(targetDid(0))).success).toBe(false);
    });

    test("another sender's requests don't count against this one", async () => {
        setEdges(priorRequests(SUPERADMIN, 20, 1));
        expect((await sendConnectRequestAction(targetDid(0))).success).toBe(true);
    });
});

describe("a silent decline stays silent", () => {
    const declined = () => ({
        _id: new ObjectId(),
        fromDid: SENDER,
        toDid: targetDid(0),
        connectStatus: "pending_sent",
        declinedAt: new Date(Date.now() - 48 * HOUR),
    });

    test("a resend inside the cooldown reads as sent, notifies nobody, and counts", async () => {
        setEdges([{ ...declined(), connectStatus: "none" }]);
        const result = await sendConnectRequestAction(targetDid(0));
        expect(result).toEqual({ success: true, message: "Connection request sent" });
        expect(notificationCount()).toBe(0);
        expect(edge(targetDid(0), SENDER)).toBeUndefined();
        expect(!!edge(SENDER, targetDid(0))?.requestedAt).toBe(true);
    });

    test("at the limit, a resend inside the cooldown is refused the same way", async () => {
        setEdges([{ ...declined(), connectStatus: "none" }, ...priorRequests(SENDER, 20, 1)]);
        const result = await sendConnectRequestAction(targetDid(0));
        expect(result.success).toBe(false);
        expect(result.message).toBe("You've sent a lot of connection requests today. Please try again tomorrow.");
    });
});

test("an unverified sender is refused, as before", async () => {
    sessionDid = UNVERIFIED;
    const result = await sendConnectRequestAction(targetDid(0));
    expect(result.success).toBe(false);
    expect(edge(UNVERIFIED, targetDid(0))).toBeUndefined();
});
