// Run: bun test src/lib/data/purge-unverified.test.ts
// The database is a set of in-memory fake collections, the vector DB a spy, and USERS_DIR a temp
// directory, so nothing real is touched.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { ObjectId } from "mongodb";
import { createFakeCollection, type FakeCollection } from "@/lib/testing/fake-collection";

const NAMES = [
    "Circles",
    "Members",
    "MembershipRequests",
    "Feeds",
    "Posts",
    "Comments",
    "Reactions",
    "ChatRooms",
    "ChatRoomMembers",
    "ChatConversations",
    "ChatMessageDocs",
    "ChatReadStates",
    "Notifications",
    "PushSubscriptions",
    "UserRelationships",
    "MessageEmailReminders",
    "EventRsvps",
    "Events",
    "CrewApplications",
] as const;
let cols = {} as Record<(typeof NAMES)[number], FakeCollection>;
const reset = () => {
    cols = Object.fromEntries(NAMES.map((n) => [n, createFakeCollection()])) as typeof cols;
};
reset();
// Each property reads the current fake, so reset() between tests takes effect.
const dbProxy = Object.fromEntries(
    NAMES.map((n) => [
        n,
        {
            find: (...a: any[]) => (cols[n] as any).find(...a),
            findOne: (...a: any[]) => (cols[n] as any).findOne(...a),
            countDocuments: (...a: any[]) => (cols[n] as any).countDocuments(...a),
            deleteMany: (...a: any[]) => (cols[n] as any).deleteMany(...a),
            updateOne: (...a: any[]) => (cols[n] as any).updateOne(...a),
        },
    ]),
);
mock.module("./db", () => dbProxy);
mock.module("@/lib/data/db", () => dbProxy);

const vdbDeleted: string[] = [];
mock.module("./vdb", () => ({ deleteVbdCircle: async (id: string) => void vdbDeleted.push(id) }));

const USERS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "purge-users-"));
mock.module("../auth/auth", () => ({ USERS_DIR }));
mock.module("@/lib/auth/auth", () => ({ USERS_DIR }));

const { planPurgeUnverifiedAccount, applyPurgePlan, VERIFICATION_ENFORCED_AT } = await import("./purge-unverified");

const BOT = "did:bot:aaaaaaaaaaaa";
const REAL = "did:real:bbbbbbbbbbbb";
const LOUNGE_ID = new ObjectId();
const LOUNGE_ROOM = new ObjectId();

const oid = (at?: Date) => (at ? ObjectId.createFromTime(Math.floor(at.getTime() / 1000)) : new ObjectId());

function seed({ botOverrides = {}, botCreated }: { botOverrides?: Record<string, unknown>; botCreated?: Date } = {}) {
    const botId = oid(botCreated);
    const botRoom = new ObjectId();
    const botFeed = new ObjectId();
    const welcome = new ObjectId();
    cols.Circles.docs.push(
        { _id: LOUNGE_ID, handle: "the-backstage-lounge", circleType: "circle", did: "did:lounge:1", members: 3 },
        {
            _id: botId,
            did: BOT,
            handle: "xkqlm-bot",
            circleType: "user",
            accountStatus: "pending_verification",
            isEmailVerified: false,
            picture: { url: "/images/default-user-picture.png" },
            ...botOverrides,
        },
        { _id: new ObjectId(), did: REAL, handle: "real-person", circleType: "user", accountStatus: "active" },
    );
    cols.Members.docs.push(
        { _id: new ObjectId(), userDid: BOT, circleId: String(botId) },
        { _id: new ObjectId(), userDid: BOT, circleId: String(LOUNGE_ID) },
        { _id: new ObjectId(), userDid: REAL, circleId: String(LOUNGE_ID) },
    );
    cols.Feeds.docs.push({ _id: botFeed, circleId: String(botId) });
    cols.ChatRooms.docs.push(
        { _id: botRoom, circleId: String(botId) },
        { _id: LOUNGE_ROOM, circleId: String(LOUNGE_ID) },
    );
    cols.ChatRoomMembers.docs.push(
        { _id: new ObjectId(), userDid: BOT, chatRoomId: String(botRoom) },
        { _id: new ObjectId(), userDid: BOT, chatRoomId: String(LOUNGE_ROOM), circleId: String(LOUNGE_ID) },
        { _id: new ObjectId(), userDid: REAL, chatRoomId: String(LOUNGE_ROOM), circleId: String(LOUNGE_ID) },
    );
    cols.ChatConversations.docs.push({ _id: welcome, handle: `welcome-${BOT}`, participants: [BOT] });
    cols.ChatMessageDocs.docs.push({ _id: new ObjectId(), conversationId: String(welcome), senderDid: "did:system:1" });
    cols.ChatReadStates.docs.push({ _id: new ObjectId(), userDid: BOT, conversationId: String(welcome) });
    cols.Notifications.docs.push(
        { _id: new ObjectId(), userId: "did:lounge-admin:1", actorDid: BOT },
        { _id: new ObjectId(), userId: REAL, actorDid: "did:someone:1" },
    );
    cols.UserRelationships.docs.push(
        {
            _id: new ObjectId(),
            fromDid: BOT,
            toDid: "did:lounge:1",
            isFollowing: true,
            connectStatus: "none",
            dmPermission: "none",
        },
        {
            _id: new ObjectId(),
            fromDid: REAL,
            toDid: "did:lounge:1",
            isFollowing: true,
            connectStatus: "none",
            dmPermission: "none",
        },
    );
    fs.mkdirSync(path.join(USERS_DIR, BOT), { recursive: true });
    fs.writeFileSync(path.join(USERS_DIR, BOT, "publicKey.pem"), "x");
    return { botId };
}

describe("purgeUnverifiedAccount", () => {
    beforeEach(() => {
        reset();
        vdbDeleted.length = 0;
        fs.rmSync(path.join(USERS_DIR, BOT), { recursive: true, force: true });
    });

    test("a bot is purged with everything signup created; the Lounge is recounted; others untouched", async () => {
        const { botId } = seed();
        const plan = await planPurgeUnverifiedAccount(BOT);
        expect(plan.skipReasons).toEqual([]);
        expect(plan.eligible).toBe(true);
        expect(plan.recountCircleIds).toEqual([String(LOUNGE_ID)]);

        const result = await applyPurgePlan(plan);
        expect(result.deleted.circles).toBe(1);
        expect(result.deleted.members).toBe(2);
        expect(result.deleted.chatRoomMembers).toBe(2);
        expect(result.deleted.chatConversations).toBe(1);
        expect(result.deleted.chatMessageDocs).toBe(1);
        expect(result.deleted.notifications).toBe(1);
        expect(result.deleted.userRelationships).toBe(1);
        expect(result.userDirRemoved).toBe(true);
        expect(vdbDeleted).toEqual([String(botId)]);
        // Stored counter was 3 (drifted); recount sets it to the real rows (only REAL is left).
        expect(result.recounted).toEqual([{ circleId: String(LOUNGE_ID), before: 3, after: 1 }]);

        expect(await cols.Circles.countDocuments({ did: REAL })).toBe(1);
        expect(await cols.Members.countDocuments({ userDid: REAL })).toBe(1);
        expect(await cols.ChatRoomMembers.countDocuments({ userDid: REAL })).toBe(1);
        expect(await cols.Notifications.countDocuments({ userId: REAL })).toBe(1);
        expect(await cols.UserRelationships.countDocuments({ fromDid: REAL })).toBe(1);
        expect(await cols.ChatRooms.countDocuments({ _id: LOUNGE_ROOM })).toBe(1);
    });

    test("active accounts are never purged, even with an unverified email (the four real people)", async () => {
        seed({ botOverrides: { accountStatus: "active" } });
        const plan = await planPurgeUnverifiedAccount(BOT);
        expect(plan.eligible).toBe(false);
        expect(plan.skipReasons).toContain("accountStatus is active");
        expect(plan.docs.circles).toEqual([]);
        let refused = "";
        try {
            await applyPurgePlan(plan);
        } catch (err) {
            refused = err instanceof Error ? err.message : String(err);
        }
        expect(refused).toContain("Refusing to purge");
        expect(await cols.Circles.countDocuments({ did: BOT })).toBe(1);
        expect(fs.existsSync(path.join(USERS_DIR, BOT))).toBe(true);
    });

    test("verified email, verified account or admin is skipped", async () => {
        for (const overrides of [
            { isEmailVerified: true },
            { isVerified: true },
            { verificationStatus: "verified" },
            { isAdmin: true },
        ]) {
            reset();
            seed({ botOverrides: overrides });
            expect((await planPurgeUnverifiedAccount(BOT)).eligible).toBe(false);
        }
    });

    test("activity skips the account: posts, sent messages, connections, followers, incoming follows", async () => {
        const cases: [string, () => void][] = [
            ["posts", () => cols.Posts.docs.push({ _id: new ObjectId(), createdBy: BOT, feedId: "elsewhere" })],
            [
                "sent messages",
                () => cols.ChatMessageDocs.docs.push({ _id: new ObjectId(), senderDid: BOT, conversationId: "x" }),
            ],
            [
                "connections or DM permissions",
                () =>
                    cols.UserRelationships.docs.push({
                        _id: new ObjectId(),
                        fromDid: REAL,
                        toDid: BOT,
                        connectStatus: "connected",
                        dmPermission: "none",
                    }),
            ],
            [
                "incoming follows",
                () =>
                    cols.UserRelationships.docs.push({
                        _id: new ObjectId(),
                        fromDid: REAL,
                        toDid: BOT,
                        isFollowing: true,
                    }),
            ],
            [
                "conversations besides the welcome DM",
                () => cols.ChatConversations.docs.push({ _id: new ObjectId(), participants: [BOT, REAL] }),
            ],
        ];
        for (const [label, add] of cases) {
            reset();
            const { botId } = seed();
            add();
            const plan = await planPurgeUnverifiedAccount(BOT);
            expect(plan.eligible).toBe(false);
            expect(plan.skipReasons.join("; ")).toContain(label);
            void botId;
        }
        reset();
        const { botId } = seed();
        cols.Members.docs.push({ _id: new ObjectId(), userDid: REAL, circleId: String(botId) });
        expect((await planPurgeUnverifiedAccount(BOT)).skipReasons.join("; ")).toContain(
            "followers of its personal circle",
        );
    });

    test("createdAfter (the automatic purge) skips accounts created before verification was enforced", async () => {
        seed({ botCreated: new Date("2026-10-01T00:00:00Z") });
        const auto = await planPurgeUnverifiedAccount(BOT, { createdAfter: VERIFICATION_ENFORCED_AT });
        expect(auto.eligible).toBe(false);
        expect(auto.skipReasons.join("; ")).toContain("before 2026-10-14T12:00:00.000Z");
        // The reviewed one-off list doesn't pass createdAfter.
        expect((await planPurgeUnverifiedAccount(BOT)).eligible).toBe(true);

        reset();
        seed({ botCreated: new Date("2026-10-20T00:00:00Z") });
        expect((await planPurgeUnverifiedAccount(BOT, { createdAfter: VERIFICATION_ENFORCED_AT })).eligible).toBe(true);
    });

    test("an auto-created artist circle goes with the account only if nobody else is in it", async () => {
        seed();
        const artistId = new ObjectId();
        cols.Circles.docs.push({
            _id: artistId,
            handle: "bot-band",
            circleType: "circle",
            createdBy: BOT,
            metadata: { peerify: { autoProvisionedFromSignup: true } },
        });
        cols.Members.docs.push({ _id: new ObjectId(), userDid: BOT, circleId: String(artistId) });
        const plan = await planPurgeUnverifiedAccount(BOT);
        expect(plan.eligible).toBe(true);
        expect(plan.circleIds).toContain(String(artistId));
        await applyPurgePlan(plan);
        expect(await cols.Circles.countDocuments({ _id: artistId })).toBe(0);

        reset();
        seed();
        cols.Circles.docs.push({
            _id: artistId,
            handle: "bot-band",
            circleType: "circle",
            createdBy: BOT,
            metadata: { peerify: { autoProvisionedFromSignup: true } },
        });
        cols.Members.docs.push({ _id: new ObjectId(), userDid: REAL, circleId: String(artistId) });
        expect((await planPurgeUnverifiedAccount(BOT)).skipReasons.join("; ")).toContain(
            "artist circle bot-band: 1 other members",
        );
    });

    test("unknown or malformed DIDs are skipped", async () => {
        seed();
        expect((await planPurgeUnverifiedAccount("did:nobody:cccccccccc")).skipReasons).toEqual([
            "no user account with this did",
        ]);
        expect((await planPurgeUnverifiedAccount("x")).skipReasons).toEqual(["not a valid did"]);
        expect((await planPurgeUnverifiedAccount("../../etc")).eligible).toBe(false);
    });
});
