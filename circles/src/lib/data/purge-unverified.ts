import fs from "fs";
import path from "path";
import { ObjectId } from "mongodb";
import {
    ChatConversations,
    ChatMessageDocs,
    ChatReadStates,
    ChatRoomMembers,
    ChatRooms,
    Circles,
    Comments,
    CrewApplications,
    EventRsvps,
    Events,
    Feeds,
    Members,
    MembershipRequests,
    MessageEmailReminders,
    Notifications,
    Posts,
    PushSubscriptions,
    Reactions,
    UserRelationships,
} from "./db";
import { deleteVbdCircle } from "./vdb";
import { USERS_DIR } from "../auth/auth";

// Removes an account that never verified its email, with everything signup and its first steps
// created. Admin delete (deleteCircle) leaves chat rows, notifications, relationship edges and the
// auto-created artist circle behind and adjusts counters with $inc; this closes those gaps and
// recounts counters from the actual rows. Shared by the one-off bot cleanup
// (scripts/purge-unverified-accounts.ts) and, later, the automatic purge of unverified accounts.
//
// Two steps so a caller can back up exactly what will go:
//   planPurgeUnverifiedAccount(did)  reads only; returns the documents to delete, or skip reasons
//   applyPurgePlan(plan)             deletes exactly those documents (by _id), the vector-DB
//                                    entries and the key directory, then recounts counters
//
// Only accounts that are still accountStatus "pending_verification" with an unverified email can
// be purged. Anything else is skipped, never partly deleted:
//   - accountStatus "active" (or anything but pending), isVerified / verificationStatus "verified",
//     a verified email, admin rights;
//   - activity a person might care about: posts, comments, reactions, sent messages, conversations
//     other than the welcome DM, connections or DM permissions, RSVPs, crew applications, followers
//     of its personal circle or incoming follows, other circles it created, or an artist circle
//     with other members, posts or events;
//   - with `createdAfter` (the automatic purge passes VERIFICATION_ENFORCED_AT): accounts created
//     before that moment. Older accounts can only go through the reviewed one-off list.
// Uploads (a picture other than the default) are listed, not deleted.

// When Batch 0 went live on prod (build 2026-10-14T11:26:17Z): from here on, unverified accounts
// get no login link and never auto-verify. The automatic purge only considers accounts created after
// this; everything older needs the reviewed one-off list.
export const VERIFICATION_ENFORCED_AT = new Date("2026-10-14T12:00:00Z");

export const PURGE_COLLECTIONS = [
    "circles",
    "members",
    "membershipRequests",
    "feeds",
    "chatRooms",
    "chatRoomMembers",
    "chatConversations",
    "chatMessageDocs",
    "chatReadStates",
    "notifications",
    "pushSubscriptions",
    "userRelationships",
    "messageEmailReminders",
] as const;
export type PurgeCollection = (typeof PURGE_COLLECTIONS)[number];

type AnyDoc = Record<string, any> & { _id: any };

export type PurgePlan = {
    did: string;
    handle?: string;
    eligible: boolean;
    skipReasons: string[];
    userCircleId?: string;
    // Circles deleted outright: the personal circle and qualifying auto-created artist circles.
    circleIds: string[];
    // Other circles the account followed or joined; their `members` counter is recounted.
    recountCircleIds: string[];
    docs: Record<PurgeCollection, AnyDoc[]>;
    uploads: string[];
    userDir: string;
    userDirExists: boolean;
};

export type PurgeResult = {
    deleted: Record<PurgeCollection, number>;
    recounted: { circleId: string; before: number | null; after: number }[];
    vdbErrors: string[];
    userDirRemoved: boolean;
};

const emptyDocs = (): Record<PurgeCollection, AnyDoc[]> =>
    Object.fromEntries(PURGE_COLLECTIONS.map((c) => [c, []])) as unknown as Record<PurgeCollection, AnyDoc[]>;

const isDefaultPicture = (url: unknown): boolean =>
    typeof url !== "string" || url === "" || url.startsWith("/") || /default/i.test(url);

const collectionFor = (name: PurgeCollection) =>
    ({
        circles: Circles,
        members: Members,
        membershipRequests: MembershipRequests,
        feeds: Feeds,
        chatRooms: ChatRooms,
        chatRoomMembers: ChatRoomMembers,
        chatConversations: ChatConversations,
        chatMessageDocs: ChatMessageDocs,
        chatReadStates: ChatReadStates,
        notifications: Notifications,
        pushSubscriptions: PushSubscriptions,
        userRelationships: UserRelationships,
        messageEmailReminders: MessageEmailReminders,
    })[name] as unknown as {
        find: (filter: object) => { toArray: () => Promise<AnyDoc[]> };
        deleteMany: (filter: object) => Promise<{ deletedCount?: number }>;
    };

const findAll = (name: PurgeCollection, filter: object) => collectionFor(name).find(filter).toArray();

export type PlanOptions = { createdAfter?: Date };

export async function planPurgeUnverifiedAccount(did: string, { createdAfter }: PlanOptions = {}): Promise<PurgePlan> {
    const plan: PurgePlan = {
        did,
        eligible: false,
        skipReasons: [],
        circleIds: [],
        recountCircleIds: [],
        docs: emptyDocs(),
        uploads: [],
        userDir: path.join(USERS_DIR, did),
        userDirExists: false,
    };
    const skip = (reason: string) => plan.skipReasons.push(reason);

    if (typeof did !== "string" || !/^[A-Za-z0-9:._-]{8,}$/.test(did)) {
        skip("not a valid did");
        return plan;
    }
    const user = (await Circles.findOne({ did, circleType: "user" })) as AnyDoc | null;
    if (!user) {
        skip("no user account with this did");
        return plan;
    }
    plan.handle = user.handle;
    plan.userCircleId = String(user._id);
    plan.userDirExists = fs.existsSync(plan.userDir);

    if (user.accountStatus !== "pending_verification") skip(`accountStatus is ${user.accountStatus ?? "unset"}`);
    if (user.isEmailVerified === true) skip("email is verified");
    if (user.isVerified === true || user.verificationStatus === "verified") skip("account is verified");
    if (user.isAdmin === true) skip("platform admin");
    const createdAt = user._id instanceof ObjectId ? user._id.getTimestamp() : undefined;
    if (createdAfter && (!createdAt || createdAt <= createdAfter)) {
        skip(
            `created ${createdAt ? createdAt.toISOString() : "at an unknown time"}, before ${createdAfter.toISOString()}`,
        );
    }
    for (const url of [user.picture?.url, user.cover?.url, ...(user.images ?? []).map((i: any) => i?.fileInfo?.url)]) {
        if (!isDefaultPicture(url)) plan.uploads.push(String(url));
    }

    // Activity that makes this a person to look at by hand, not a bot to purge.
    const activity: [string, Promise<number>][] = [
        ["posts", Posts.countDocuments({ createdBy: did })],
        ["comments", Comments.countDocuments({ createdBy: did })],
        ["reactions", Reactions.countDocuments({ userDid: did })],
        ["sent messages", ChatMessageDocs.countDocuments({ senderDid: did })],
        ["RSVPs", EventRsvps.countDocuments({ userDid: did })],
        ["crew applications", CrewApplications.countDocuments({ userDid: did })],
        [
            "followers of its personal circle",
            Members.countDocuments({ circleId: String(user._id), userDid: { $ne: did } }),
        ],
        ["incoming follows", UserRelationships.countDocuments({ toDid: did, isFollowing: true })],
        [
            "connections or DM permissions",
            UserRelationships.countDocuments({
                $and: [
                    { $or: [{ fromDid: did }, { toDid: did }] },
                    { $or: [{ connectStatus: { $nin: ["none", null] } }, { dmPermission: { $nin: ["none", null] } }] },
                ],
            }),
        ],
    ];
    for (const [label, count] of activity) {
        const n = await count;
        if (n > 0) skip(`${n} ${label}`);
    }

    const welcomeHandle = `welcome-${did}`;
    const conversations = await findAll("chatConversations", { participants: did });
    const otherConversations = conversations.filter((c) => c.handle !== welcomeHandle);
    if (otherConversations.length > 0) skip(`${otherConversations.length} conversations besides the welcome DM`);

    // Auto-created artist circles: deleted with the account only if nobody else is in them and
    // they hold no content.
    const artistCircles = (await Circles.find({
        createdBy: did,
        circleType: "circle",
        "metadata.peerify.autoProvisionedFromSignup": true,
    }).toArray()) as AnyDoc[];
    const otherCreated = await Circles.countDocuments({
        createdBy: did,
        circleType: { $ne: "user" },
        "metadata.peerify.autoProvisionedFromSignup": { $ne: true },
    });
    if (otherCreated > 0) skip(`${otherCreated} other circles created by this account`);
    for (const c of artistCircles) {
        const id = String(c._id);
        const others = await Members.countDocuments({ circleId: id, userDid: { $ne: did } });
        const feeds = await Feeds.find({ circleId: id }).toArray();
        const posts = feeds.length
            ? await Posts.countDocuments({ feedId: { $in: feeds.map((f: AnyDoc) => String(f._id)) } })
            : 0;
        const events = await Events.countDocuments({ circleId: id });
        if (others > 0) skip(`artist circle ${c.handle}: ${others} other members`);
        if (posts > 0) skip(`artist circle ${c.handle}: ${posts} posts`);
        if (events > 0) skip(`artist circle ${c.handle}: ${events} events`);
        if (!isDefaultPicture(c.picture?.url)) plan.uploads.push(String(c.picture.url));
    }

    if (plan.skipReasons.length > 0) return plan;

    plan.circleIds = [plan.userCircleId, ...artistCircles.map((c) => String(c._id))];
    const circleIds = plan.circleIds;

    plan.docs.circles = [user, ...artistCircles];
    plan.docs.members = await findAll("members", { $or: [{ userDid: did }, { circleId: { $in: circleIds } }] });
    plan.docs.membershipRequests = await findAll("membershipRequests", {
        $or: [{ userDid: did }, { circleId: { $in: circleIds } }],
    });
    plan.docs.feeds = await findAll("feeds", { circleId: { $in: circleIds } });
    const ownFeedIds = plan.docs.feeds.map((f) => String(f._id));
    const postsInOwnFeeds = ownFeedIds.length ? await Posts.countDocuments({ feedId: { $in: ownFeedIds } }) : 0;
    if (postsInOwnFeeds > 0) {
        skip(`${postsInOwnFeeds} posts in its own feeds`);
        plan.circleIds = [];
        plan.docs = emptyDocs();
        return plan;
    }
    plan.docs.chatRooms = await findAll("chatRooms", { circleId: { $in: circleIds } });
    const roomIds = plan.docs.chatRooms.map((r) => String(r._id));
    plan.docs.chatRoomMembers = await findAll("chatRoomMembers", {
        $or: [{ userDid: did }, { chatRoomId: { $in: roomIds } }],
    });
    plan.docs.chatConversations = conversations;
    const conversationIds = conversations.map((c) => String(c._id));
    plan.docs.chatMessageDocs = await findAll("chatMessageDocs", { conversationId: { $in: conversationIds } });
    plan.docs.chatReadStates = await findAll("chatReadStates", {
        $or: [{ userDid: did }, { conversationId: { $in: conversationIds } }],
    });
    plan.docs.notifications = await findAll("notifications", { $or: [{ userId: did }, { actorDid: did }] });
    plan.docs.pushSubscriptions = await findAll("pushSubscriptions", { userId: did });
    plan.docs.userRelationships = await findAll("userRelationships", { $or: [{ fromDid: did }, { toDid: did }] });
    plan.docs.messageEmailReminders = await findAll("messageEmailReminders", {
        $or: [{ senderDid: did }, { recipientDid: did }],
    });

    plan.recountCircleIds = [
        ...new Set(plan.docs.members.map((m) => String(m.circleId)).filter((id) => !circleIds.includes(id))),
    ];
    plan.eligible = true;
    return plan;
}

export async function applyPurgePlan(plan: PurgePlan): Promise<PurgeResult> {
    if (!plan.eligible) throw new Error(`Refusing to purge ${plan.did}: ${plan.skipReasons.join("; ")}`);
    const deleted = Object.fromEntries(PURGE_COLLECTIONS.map((c) => [c, 0])) as Record<PurgeCollection, number>;

    for (const name of PURGE_COLLECTIONS) {
        const ids = plan.docs[name].map((d) => d._id);
        if (ids.length === 0) continue;
        const res = await collectionFor(name).deleteMany({ _id: { $in: ids } });
        deleted[name] = res.deletedCount ?? 0;
    }

    const vdbErrors: string[] = [];
    for (const circleId of plan.circleIds) {
        try {
            await deleteVbdCircle(circleId);
        } catch (err) {
            vdbErrors.push(`${circleId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    let userDirRemoved = false;
    if (plan.userDirExists && path.dirname(plan.userDir) === USERS_DIR && path.basename(plan.userDir) === plan.did) {
        fs.rmSync(plan.userDir, { recursive: true, force: true });
        userDirRemoved = !fs.existsSync(plan.userDir);
    }

    const recounted: PurgeResult["recounted"] = [];
    for (const circleId of plan.recountCircleIds) {
        if (!ObjectId.isValid(circleId)) continue;
        const circle = (await Circles.findOne(
            { _id: new ObjectId(circleId) },
            { projection: { members: 1 } },
        )) as AnyDoc | null;
        if (!circle) continue;
        const after = await Members.countDocuments({ circleId });
        await Circles.updateOne({ _id: new ObjectId(circleId) }, { $set: { members: after } });
        recounted.push({ circleId, before: typeof circle.members === "number" ? circle.members : null, after });
    }

    return { deleted, recounted, vdbErrors, userDirRemoved };
}
