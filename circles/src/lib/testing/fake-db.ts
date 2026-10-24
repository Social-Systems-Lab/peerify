// A complete stand-in for "@/lib/data/db": every collection it exports, each backed by a fake
// collection (fake-collection.ts), so whole modules (data layer, server actions, routes) can be
// imported in tests without a database. Bun refuses a mocked module that lacks any name another
// module imports, so this lists every export of db.ts; keep it in sync when collections are added.
// aggregate() has no pipeline engine: a test sets the documents a collection's aggregate returns.

import { createFakeCollection, type FakeCollection } from "./fake-collection";

const COLLECTION_NAMES = [
    "Circles",
    "ServerSettingsCollection",
    "Members",
    "MembershipRequests",
    "CrewApplications",
    "AdminInvitations",
    "Feeds",
    "Posts",
    "Comments",
    "Reactions",
    "Skills",
    "Sdgs",
    "ChatRooms",
    "ChatMessages",
    "ChatRoomMembers",
    "Challenges",
    "Proposals",
    "Issues",
    "Tasks",
    "Tracks",
    "FundingAsks",
    "Goals",
    "Events",
    "EventRsvps",
    "EventInvitations",
    "EventHostChangeRequests",
    "GoalMembers",
    "RankedLists",
    "AggregateRanks",
    "UserNotificationSettings",
    "DefaultNotificationSettings",
    "Notifications",
    "PushSubscriptions",
    "ChatConversations",
    "ChatMessageDocs",
    "ChatReadStates",
    "MessageEmailReminders",
    "PlatformBroadcastMessages",
    "StripeWebhookEvents",
    "UserRelationships",
    "HumanityVerifications",
    "PlatformSettingsCollection",
    "RateLimits",
    "UsedAltchaChallenges",
    "CapturedEmails",
    "Spaces",
] as const;

export type CollectionName = (typeof COLLECTION_NAMES)[number];
type Doc = Record<string, any>;

export const createFakeDb = () => {
    let cols = {} as Record<CollectionName, FakeCollection>;
    let aggregateResults = {} as Partial<Record<CollectionName, Doc[]>>;

    // Fresh, empty collections; seed some with documents.
    const reset = (seed: Partial<Record<CollectionName, Doc[]>> = {}) => {
        cols = Object.fromEntries(COLLECTION_NAMES.map((n) => [n, createFakeCollection(seed[n] ?? [])])) as typeof cols;
        aggregateResults = {};
    };
    reset();

    // Each property reads the current fake, so reset() between tests takes effect.
    const collection = (n: CollectionName) => ({
        find: (...a: any[]) => (cols[n] as any).find(...a),
        findOne: (...a: any[]) => (cols[n] as any).findOne(...a),
        countDocuments: (...a: any[]) => (cols[n] as any).countDocuments(...a),
        insertOne: (...a: any[]) => (cols[n] as any).insertOne(...a),
        deleteOne: (...a: any[]) => (cols[n] as any).deleteOne(...a),
        deleteMany: (...a: any[]) => (cols[n] as any).deleteMany(...a),
        updateOne: (...a: any[]) => (cols[n] as any).updateOne(...a),
        findOneAndUpdate: (...a: any[]) => (cols[n] as any).findOneAndUpdate(...a),
        aggregate: () => ({ toArray: async () => (aggregateResults[n] ?? []).map((d) => ({ ...d })) }),
        // Some modules create indexes at import time.
        createIndex: async () => "fake-index",
        createIndexes: async () => [],
    });

    const dbModule = {
        ...Object.fromEntries(COLLECTION_NAMES.map((n) => [n, collection(n)])),
        client: undefined,
        db: undefined,
        getDb: async () => {
            throw new Error("fake-db: no real database in tests");
        },
    };

    return {
        module: dbModule,
        reset,
        col: (n: CollectionName) => cols[n],
        setAggregateResult: (n: CollectionName, docs: Doc[]) => {
            aggregateResults[n] = docs;
        },
    };
};
