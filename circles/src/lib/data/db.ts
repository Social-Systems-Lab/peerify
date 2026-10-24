import { MongoClient, MongoClientOptions, Db, Collection } from "mongodb";
import {
    ServerSettings,
    Circle,
    Member,
    MembershipRequest,
    CrewApplication,
    AdminInvitation,
    Feed,
    Post,
    Reaction,
    Comment,
    Cause as SDG,
    Skill,
    ChatRoom,
    ChatMessage,
    ChatRoomMember,
    Challenge,
    Proposal,
    Issue,
    Task,
    Track,
    FundingAsk,
    RankedList,
    Goal,
    GoalMember, // Added GoalMember model
    UserNotificationSetting, // Added UserNotificationSetting model
    DefaultNotificationSetting, // Added DefaultNotificationSetting model
    Event,
    EventRsvp,
    EventInvitation,
    EventHostChangeRequest,
    Notification,
    PushSubscriptionDoc,
    HumanityVerification,
    PlatformSettings,
    SpaceDoc,
} from "@/models/models";
import { AggregateRank } from "./ranking";
import { ChatConversation, ChatMessageDoc, ChatReadState, MessageEmailReminder } from "@/lib/chat/mongo-types";
import type { PlatformBroadcastMessage } from "./platform-broadcasts";

// One document per rate-limit key (see rate-limit.ts); expiresAt drives a TTL index. failures is set
// only on failed-attempt counters (recordFailure).
export type RateLimitDoc = { _id: string; until: Date; expiresAt: Date; failures?: number };
// One document per spent ALTCHA challenge (see altcha.ts); expiresAt (the challenge's own expiry)
// drives a TTL index.
export type UsedAltchaChallengeDoc = { _id: string; expiresAt: Date };
// Staging only: one document per email captured instead of sent (EMAIL_CAPTURE_MODE, see
// src/lib/email/captured-emails.ts). Nothing writes here with capture mode off, so prod never has the
// collection; expiresAt drives a TTL index created on the first capture.
export type CapturedEmailDoc = {
    to: string;
    templateAlias: string;
    templateModel: Record<string, unknown>;
    createdAt: Date;
    expiresAt: Date;
};

// No fallback: a missing MONGODB_URI used to become admin:password@127.0.0.1, which only produced
// "Authentication failed" noise against a server with auth on. The build (IS_BUILD=true) never
// connects, so it may run without the URI.
const MONGODB_URI = process.env.MONGODB_URI ?? "";
if (!MONGODB_URI && process.env.IS_BUILD !== "true") {
    throw new Error("MONGODB_URI is not set; refusing to start without a database URI.");
}

const dbName = (MONGODB_URI && new URL(MONGODB_URI).pathname.replace(/^\//, "")) || "circles";

const options: MongoClientOptions = {};

// Initialize client and collections conditionally
let client: MongoClient;
let db: Db;
let Circles: Collection<Circle>;
let ServerSettingsCollection: Collection<ServerSettings>;
let PlatformSettingsCollection: Collection<PlatformSettings>;
let Members: Collection<Member>;
let MembershipRequests: Collection<MembershipRequest>;
let CrewApplications: Collection<CrewApplication>;
let AdminInvitations: Collection<AdminInvitation>;
let Feeds: Collection<Feed>;
let Posts: Collection<Post>;
let Comments: Collection<Comment>;
let Reactions: Collection<Reaction>;
let Sdgs: Collection<SDG>;
let Skills: Collection<Skill>;
let ChatRooms: Collection<ChatRoom>;
let ChatMessages: Collection<ChatMessage>;
let ChatRoomMembers: Collection<ChatRoomMember>;
let Challenges: Collection<Challenge>;
let Proposals: Collection<Proposal>;
let Issues: Collection<Issue>;
let Tasks: Collection<Task>;
let Tracks: Collection<Track>;
let FundingAsks: Collection<FundingAsk>;
let Goals: Collection<Goal>;
let Events: Collection<Event>;
let EventRsvps: Collection<EventRsvp>;
let EventInvitations: Collection<EventInvitation>;
let EventHostChangeRequests: Collection<EventHostChangeRequest>;
let GoalMembers: Collection<GoalMember>; // Added GoalMembers collection
let RankedLists: Collection<RankedList>;
let AggregateRanks: Collection<AggregateRank>;
let UserNotificationSettings: Collection<UserNotificationSetting>; // Added UserNotificationSettings collection
let DefaultNotificationSettings: Collection<DefaultNotificationSetting>; // Added DefaultNotificationSettings collection
let Notifications: Collection<Notification>;
let PushSubscriptions: Collection<PushSubscriptionDoc>;
let ChatConversations: Collection<ChatConversation>;
let ChatMessageDocs: Collection<ChatMessageDoc>;
let ChatReadStates: Collection<ChatReadState>;
let MessageEmailReminders: Collection<MessageEmailReminder>;
let PlatformBroadcastMessages: Collection<PlatformBroadcastMessage>;
let StripeWebhookEvents: Collection<any>;
let UserRelationships: Collection<any>;
let HumanityVerifications: Collection<HumanityVerification>;
let RateLimits: Collection<RateLimitDoc>;
let UsedAltchaChallenges: Collection<UsedAltchaChallengeDoc>;
let CapturedEmails: Collection<CapturedEmailDoc>;
let Spaces: Collection<SpaceDoc>;

// Only initialize the database connection if not in build mode
if (process.env.IS_BUILD !== "true") {
    client = new MongoClient(MONGODB_URI, options);
    // Connect the client - this establishes the connection more reliably
    client.connect().catch((err) => {
        console.error("MongoDB connection error:", err);
    });

    db = client.db(dbName);

    Circles = db.collection<Circle>("circles");
    ServerSettingsCollection = db.collection<ServerSettings>("serverSettings");
    Members = db.collection<Member>("members");
    MembershipRequests = db.collection<MembershipRequest>("membershipRequests");
    CrewApplications = db.collection<CrewApplication>("crewApplications");
    AdminInvitations = db.collection<AdminInvitation>("adminInvitations");
    Feeds = db.collection<Feed>("feeds");
    Posts = db.collection<Post>("posts");
    Comments = db.collection<Comment>("comments");
    Reactions = db.collection<Reaction>("reactions");
    Sdgs = db.collection<SDG>("sdgs");
    Skills = db.collection<Skill>("skills");
    ChatRooms = db.collection<ChatRoom>("chatRooms");
    ChatMessages = db.collection<ChatMessage>("chatMessages");
    ChatRoomMembers = db.collection<ChatRoomMember>("chatRoomMembers");
    Challenges = db.collection<Challenge>("challenges");
    Proposals = db.collection<Proposal>("proposals");
    Issues = db.collection<Issue>("issues");
    Tasks = db.collection<Task>("tasks");
    Tracks = db.collection<Track>("tracks");
    FundingAsks = db.collection<FundingAsk>("fundingAsks");
    Goals = db.collection<Goal>("goals");
    Events = db.collection<Event>("events");
    EventRsvps = db.collection<EventRsvp>("eventRsvps");
    EventInvitations = db.collection<EventInvitation>("eventInvitations");
    EventHostChangeRequests = db.collection<EventHostChangeRequest>("eventHostChangeRequests");
    GoalMembers = db.collection<GoalMember>("goalMembers"); // Initialize GoalMembers
    RankedLists = db.collection<RankedList>("rankedLists");
    AggregateRanks = db.collection<AggregateRank>("aggregateRanks");
    UserNotificationSettings = db.collection<UserNotificationSetting>("userNotificationSettings");
    DefaultNotificationSettings = db.collection<DefaultNotificationSetting>("defaultNotificationSettings");
    Notifications = db.collection<Notification>("notifications");
    PushSubscriptions = db.collection<PushSubscriptionDoc>("pushSubscriptions");
    PushSubscriptions?.createIndex({ endpoint: 1 }, { unique: true });
    PushSubscriptions?.createIndex({ userId: 1 });
    ChatConversations = db.collection<ChatConversation>("chatConversations");
    ChatMessageDocs = db.collection<ChatMessageDoc>("chatMessageDocs");
    ChatReadStates = db.collection<ChatReadState>("chatReadStates");
    MessageEmailReminders = db.collection<MessageEmailReminder>("messageEmailReminders");
    PlatformBroadcastMessages = db.collection<PlatformBroadcastMessage>("platformBroadcastMessages");
    StripeWebhookEvents = db.collection("stripeWebhookEvents");
    UserRelationships = db.collection("userRelationships");
    HumanityVerifications = db.collection<HumanityVerification>("humanityVerifications");
    PlatformSettingsCollection = db.collection<PlatformSettings>("platformSettings");
    RateLimits = db.collection<RateLimitDoc>("rateLimits");
    UsedAltchaChallenges = db.collection<UsedAltchaChallengeDoc>("usedAltchaChallenges");
    CapturedEmails = db.collection<CapturedEmailDoc>("capturedEmails");
    // Pop-up and private spaces (see lib/data/space.ts); every read is by owner or by a platform admin.
    Spaces = db.collection<SpaceDoc>("spaces");
    Spaces?.createIndex({ ownerDid: 1 });
}
export async function getDb() {
  if (!client) throw new Error("Mongo client not initialised (IS_BUILD=true?)");
  // If not connected yet (or got reloaded), ensure connection is established
  await client.connect();
  return client.db(dbName);
}

export {
    client,
    db,
    Circles,
    ServerSettingsCollection,
    Members,
    MembershipRequests,
    CrewApplications,
    AdminInvitations,
    Feeds,
    Posts,
    Comments,
    Reactions,
    Skills,
    Sdgs,
    ChatRooms,
    ChatMessages,
    ChatRoomMembers,
    Challenges,
    Proposals,
    Issues,
    Tasks,
    Tracks,
    FundingAsks,
    Goals,
    Events,
    EventRsvps,
    EventInvitations,
    EventHostChangeRequests,
    GoalMembers, // Export GoalMembers
    RankedLists,
    AggregateRanks,
    UserNotificationSettings,
    DefaultNotificationSettings,
    Notifications,
    PushSubscriptions,
    ChatConversations,
    ChatMessageDocs,
    ChatReadStates,
    MessageEmailReminders,
    PlatformBroadcastMessages,
    StripeWebhookEvents,
    UserRelationships,
    HumanityVerifications,
    PlatformSettingsCollection,
    RateLimits,
    UsedAltchaChallenges,
    CapturedEmails,
    Spaces,
};
