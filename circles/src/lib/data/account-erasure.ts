// GDPR erasure of a personal account: deletes everything the person created or that is about them,
// across every collection, both storage buckets, the vector DB and the key directory. Nothing is
// anonymised. The only rewrites in other people's documents remove references to the person:
//   - lists and fields holding their DID or circle id are pulled or unset (followers, invitations,
//     participants, bookmarks, task assignment, chat reactions, …);
//   - a few audit fields that must keep a value get DELETED_USER_DID instead: who vouched for a
//     humanity verification, who reviewed/verified something, and the uploader of a track kept in
//     an artist circle that still has other admins (Tim, 2026-10-21);
//   - counters are recounted from the rows that are left.
// Other people's own content is never deleted, except what hangs off something being deleted:
// comments and reactions on the person's posts, replies under their comments and chat threads,
// RSVPs to their events, posts in their own feeds, conversations about them (welcome, booking and
// contact threads), and conversations left with no messages.
// Mentions of the person inside other people's text ("[Name](/circles/<id>)") are left as they are.
//
// "The person" is their DID plus the DIDs of their own artist circles: auto-created at signup and
// with no other member (the same rule as purge-unverified.ts). Those circles are erased with them.
// Content posted as an artist/venue circle they co-run carries that circle's DID and is kept.
//
// Two steps, like purge-unverified.ts:
//   planAccountErasure(did)   reads only; what will be deleted, updated, recounted and removed
//   applyAccountErasure(plan) does it: marks the account, removes files, vector-DB entries, updates
//                             references, deletes rows children-first, recounts, removes the key
//                             directory, and deletes the account itself last.
// Rerunnable: the plan is rebuilt from what is left, deletes go by _id, and the account row (which
// the plan starts from) goes last, so a run that stopped halfway is finished by running it again.
// Once the account row is gone, a rerun finds nothing and does nothing.

import { ObjectId } from "mongodb";
import { db } from "./db";
import { deleteVbdCircle, deleteVbdPost } from "./vdb";
import { listObjectKeysByPrefix, removeObjectKeys } from "./storage";
import { isAutomaticConversation, recountMemberCounters, removeUserKeyDir } from "./purge-unverified";

export const DELETED_USER_DID = "deleted-user";

// Real MongoDB collection names, in deletion order: children before parents, so that a run that
// stops partway leaves every remaining row still findable from something the plan starts from.
// The person's own account row is deleted after all of these (see applyAccountErasure).
export const ERASURE_COLLECTIONS = [
    "notifications",
    "pushSubscriptions",
    "userNotificationSettings",
    "messageEmailReminders",
    "reactions",
    "comments",
    "chatReadStates",
    "chatRoomMembers",
    "chatMessageDocs",
    "chatConversations",
    "chatRooms",
    "eventRsvps",
    "eventInvitations",
    "eventHostChangeRequests",
    "goalMembers",
    "rankedLists",
    "aggregateRanks",
    "posts",
    "events",
    "tasks",
    "issues",
    "goals",
    "proposals",
    "fundingAsks",
    "tracks",
    "crewApplications",
    "membershipRequests",
    "members",
    "userRelationships",
    "humanityVerifications",
    "verificationMessages",
    "verifications",
    "adminInvitations",
    "adminRoleRemovalRequests",
    "detachCircleRequests",
    "attachCircleRequests",
    "peerify_pledges",
    "capturedEmails",
    "spaces",
    "feeds",
    "circles",
] as const;
export type ErasureCollection = (typeof ERASURE_COLLECTIONS)[number];

type AnyDoc = Record<string, any> & { _id: any };
type Fields = Record<string, any>;
type Col = {
    find: (filter: object) => { toArray: () => Promise<AnyDoc[]>; sort: (s: object) => any };
    findOne: (filter: object) => Promise<AnyDoc | null>;
    countDocuments: (filter: object) => Promise<number>;
    deleteMany: (filter: object) => Promise<{ deletedCount?: number }>;
    updateOne: (filter: object, update: object) => Promise<unknown>;
};
const col = (name: ErasureCollection) => db.collection(name) as unknown as Col;
const findAll = (name: ErasureCollection, filter: object) => col(name).find(filter).toArray();

const str = (id: unknown) => String(id);
const strs = (docs: AnyDoc[]) => docs.map((d) => str(d._id));
// Ids are stored as strings in some fields and ObjectIds in others; match both.
const idVariants = (ids: Iterable<string>): (string | ObjectId)[] => {
    const out: (string | ObjectId)[] = [];
    for (const id of ids) {
        out.push(id);
        if (ObjectId.isValid(id) && String(new ObjectId(id)) === id) out.push(new ObjectId(id));
    }
    return out;
};
const notIn = (list: string[], set: Set<string>) => list.filter((v) => !set.has(v));
const STORAGE_URL_PREFIX = "/storage/";
const storageKeyFromUrl = (url: unknown): string | null => {
    if (typeof url !== "string") return null;
    const i = url.indexOf(STORAGE_URL_PREFIX);
    if (i === -1) return null;
    const key = url.substring(i + STORAGE_URL_PREFIX.length).split(/[?#]/)[0];
    return key ? decodeURIComponent(key) : null;
};

export type ReferenceUpdate = { collection: ErasureCollection; _id: any; set?: Fields; unset?: string[] };

export type ErasurePlan = {
    did: string;
    found: boolean;
    userCircleId?: string;
    // The person's DID plus their own artist circles' DIDs.
    dids: string[];
    // Their profile circle plus their own artist circles; deleted with everything in them.
    ownCircleIds: string[];
    deletes: Record<ErasureCollection, AnyDoc[]>;
    updates: ReferenceUpdate[];
    recount: {
        memberCircleIds: string[];
        postIds: string[];
        commentIds: string[];
        proposalIds: string[];
        trackIds: string[];
        threadStarterIds: string[];
    };
    files: { publicPrefixes: string[]; publicKeys: string[]; privatePrefixes: string[]; privateKeys: string[] };
};

export type ErasureResult = {
    did: string;
    found: boolean;
    deleted: Record<string, number>;
    updated: Record<string, number>;
    files: { public: number; private: number };
    recounted: number;
    vdbErrors: string[];
    userDirRemoved: boolean;
};

const emptyDeletes = () =>
    Object.fromEntries(ERASURE_COLLECTIONS.map((c) => [c, []])) as unknown as Record<ErasureCollection, AnyDoc[]>;

const imageUrls = (images: unknown): unknown[] =>
    Array.isArray(images) ? images.map((i: any) => i?.fileInfo?.url ?? i?.url) : [];

// Files referenced by a document that is being deleted. Explicit fields only, so a deleted doc
// that merely points at someone else's file (e.g. a link preview) never removes it.
const fileUrlsOf = (collection: ErasureCollection, doc: AnyDoc): unknown[] => {
    switch (collection) {
        case "posts":
            return imageUrls(doc.media);
        case "events":
        case "tasks":
        case "issues":
        case "proposals":
            return imageUrls(doc.images);
        case "goals":
            return [...imageUrls(doc.images), ...imageUrls(doc.resultImages)];
        case "fundingAsks":
            return [doc.coverImage?.url];
        case "chatMessageDocs":
        case "verificationMessages":
            return Array.isArray(doc.attachments) ? doc.attachments.map((a: any) => a?.url) : [];
        case "chatConversations":
        case "chatRooms":
            return [doc.picture?.url, doc.metadata?.senderAvatarUrl];
        case "circles":
            return [
                doc.picture?.url,
                doc.cover?.url,
                ...imageUrls(doc.images),
                ...(Array.isArray(doc.tourTeamOfferings)
                    ? doc.tourTeamOfferings.flatMap((o: any) => (o?.photos ?? []).map((p: any) => p?.url))
                    : []),
            ];
        default:
            return [];
    }
};

export async function planAccountErasure(did: string): Promise<ErasurePlan> {
    if (typeof did !== "string" || !/^[A-Za-z0-9:._-]{8,}$/.test(did) || did === DELETED_USER_DID) {
        throw new Error("Refusing to erase: not a valid did");
    }
    const plan: ErasurePlan = {
        did,
        found: false,
        dids: [did],
        ownCircleIds: [],
        deletes: emptyDeletes(),
        updates: [],
        recount: { memberCircleIds: [], postIds: [], commentIds: [], proposalIds: [], trackIds: [], threadStarterIds: [] },
        files: { publicPrefixes: [], publicKeys: [], privatePrefixes: [], privateKeys: [] },
    };

    const user = await col("circles").findOne({ did, circleType: "user" });
    if (!user) return plan;
    plan.found = true;
    const uid = str(user._id);
    plan.userCircleId = uid;
    const email: string | undefined = typeof user.email === "string" && user.email ? user.email : undefined;

    // Seen ids per collection, so each doc is planned once.
    const seen = Object.fromEntries(ERASURE_COLLECTIONS.map((c) => [c, new Set<string>()])) as Record<
        ErasureCollection,
        Set<string>
    >;
    const del = (name: ErasureCollection, docs: AnyDoc[]): AnyDoc[] => {
        const added: AnyDoc[] = [];
        for (const doc of docs) {
            const id = str(doc._id);
            if (seen[name].has(id)) continue;
            seen[name].add(id);
            plan.deletes[name].push(doc);
            added.push(doc);
        }
        return added;
    };
    const deletedIds = (name: ErasureCollection) => [...seen[name]];
    const update = (collection: ErasureCollection, doc: AnyDoc, set: Fields, unset: string[] = []) => {
        if (seen[collection].has(str(doc._id))) return; // being deleted anyway
        plan.updates.push({
            collection,
            _id: doc._id,
            ...(Object.keys(set).length ? { set } : {}),
            ...(unset.length ? { unset } : {}),
        });
    };

    // --- Who and which circles ------------------------------------------------------------------
    const artistCandidates = await findAll("circles", {
        createdBy: did,
        circleType: "circle",
        "metadata.peerify.autoProvisionedFromSignup": true,
    });
    const ownArtists: AnyDoc[] = [];
    for (const c of artistCandidates) {
        const others = await col("members").countDocuments({ circleId: str(c._id), userDid: { $ne: did } });
        if (others === 0) ownArtists.push(c);
    }
    const own = [uid, ...strs(ownArtists)];
    const ownSet = new Set(own);
    const dids = [did, ...ownArtists.map((c) => c.did).filter((d): d is string => typeof d === "string" && !!d)];
    const didSet = new Set(dids);
    plan.ownCircleIds = own;
    plan.dids = dids;
    const inDids = { $in: dids };
    const inOwn = { $in: idVariants(own) };
    const dropDids = (list: unknown) => (Array.isArray(list) ? list.filter((v) => !didSet.has(v)) : list);
    const dropOwn = (list: unknown) => (Array.isArray(list) ? list.filter((v) => !ownSet.has(str(v))) : list);

    // --- Membership and circle-level rows -------------------------------------------------------
    const memberRows = del("members", await findAll("members", { $or: [{ userDid: inDids }, { circleId: inOwn }] }));
    plan.recount.memberCircleIds = [...new Set(memberRows.map((m) => str(m.circleId)))].filter((id) => !ownSet.has(id));
    for (const name of ["membershipRequests", "crewApplications"] as const) {
        del(name, await findAll(name, { $or: [{ userDid: inDids }, { circleId: inOwn }] }));
    }
    const feeds = del("feeds", await findAll("feeds", { circleId: inOwn }));
    const ownFeedIds = strs(feeds);

    // --- Things they made: events, tasks, issues, goals, proposals, funding asks, tracks --------
    const items: Record<string, AnyDoc[]> = {};
    for (const name of ["events", "tasks", "issues", "goals", "proposals"] as const) {
        items[name] = del(name, await findAll(name, { $or: [{ circleId: inOwn }, { createdBy: inDids }] }));
    }
    items.fundingAsks = del(
        "fundingAsks",
        await findAll("fundingAsks", { $or: [{ circleId: inOwn }, { createdByDid: inDids }] }),
    );
    const eventIds = strs(items.events);
    const goalIds = strs(items.goals);
    const proposalIds = strs(items.proposals);
    const itemIds = Object.values(items).flatMap(strs);

    // Tracks: kept (uploader replaced) only in an artist circle that isn't theirs and still has
    // another admin; deleted otherwise.
    const trackCandidates = await findAll("tracks", { $or: [{ artistProfileId: inOwn }, { createdBy: inDids }] });
    for (const t of trackCandidates) {
        const artistId = str(t.artistProfileId ?? "");
        const otherAdmins =
            !ownSet.has(artistId) && artistId
                ? await col("members").countDocuments({
                      circleId: artistId,
                      userGroups: "admins",
                      userDid: { $nin: dids },
                  })
                : 0;
        if (otherAdmins > 0) {
            if (didSet.has(t.createdBy)) update("tracks", t, { createdBy: DELETED_USER_DID });
        } else {
            del("tracks", [t]);
        }
    }
    const trackIds = deletedIds("tracks");

    // --- Posts ----------------------------------------------------------------------------------
    // Their own posts anywhere, everything in their own feeds, and the comment/noticeboard/result
    // posts of the items above.
    const shadowPostIds = Object.values(items)
        .flat()
        .flatMap((i) => [i.commentPostId, i.noticeboardPostId, i.resultPostId])
        .filter((v) => v !== undefined && v !== null && v !== "")
        .map(str);
    del(
        "posts",
        await findAll("posts", {
            $or: [
                { createdBy: inDids },
                { feedId: { $in: idVariants(ownFeedIds) } },
                { _id: { $in: idVariants(shadowPostIds) } },
                { parentItemId: { $in: idVariants(itemIds) } },
            ],
        }),
    );
    const postIds = deletedIds("posts");

    // --- Comments: theirs, everything on deleted posts/tracks, and every reply under those ------
    let frontier = del(
        "comments",
        await findAll("comments", {
            $or: [
                { createdBy: inDids },
                { postId: { $in: idVariants(postIds) } },
                { trackId: { $in: idVariants(trackIds) } },
            ],
        }),
    );
    while (frontier.length > 0) {
        frontier = del("comments", await findAll("comments", { parentCommentId: { $in: idVariants(strs(frontier)) } }));
    }
    const commentIds = deletedIds("comments");

    // --- Chat -----------------------------------------------------------------------------------
    const conversations = await findAll("chatConversations", {
        $or: [{ participants: inDids }, { circleId: inOwn }, { "metadata.bookerDid": inDids }],
    });
    const isAboutThem = (c: AnyDoc) =>
        ownSet.has(str(c.circleId ?? "")) ||
        didSet.has(c.metadata?.bookerDid) ||
        (typeof c.handle === "string" && dids.some((d) => c.handle.includes(d))) ||
        isAutomaticConversation(c.participants, did);
    del("chatConversations", conversations.filter(isAboutThem));

    // Messages they sent, and every reply in a thread one of their messages started.
    let msgFrontier = del("chatMessageDocs", await findAll("chatMessageDocs", { senderDid: inDids }));
    while (msgFrontier.length > 0) {
        const starters = msgFrontier.filter((m) => m.thread);
        msgFrontier = starters.length
            ? del("chatMessageDocs", await findAll("chatMessageDocs", { threadId: { $in: idVariants(strs(starters)) } }))
            : [];
    }
    // Conversations they were in that would have no messages left go too; the rest just lose them.
    for (const c of conversations) {
        if (seen.chatConversations.has(str(c._id))) continue;
        const remaining = await col("chatMessageDocs").countDocuments({
            conversationId: { $in: idVariants([str(c._id)]) },
            _id: { $nin: idVariants(deletedIds("chatMessageDocs")) },
        });
        if (remaining === 0) {
            del("chatConversations", [c]);
            continue;
        }
        const set: Fields = { participants: dropDids(c.participants) };
        if (Array.isArray(c.dmGrants)) {
            set.dmGrants = c.dmGrants.filter((g: any) => !didSet.has(g?.grantedBy) && !ownSet.has(str(g?.circleId)));
        }
        update("chatConversations", c, set);
    }
    const conversationIds = deletedIds("chatConversations");
    // Every message in a deleted conversation (anyone's).
    del(
        "chatMessageDocs",
        await findAll("chatMessageDocs", { conversationId: { $in: idVariants(conversationIds) } }),
    );
    const messageIds = deletedIds("chatMessageDocs");
    const deletedMessages = new Set(messageIds);
    plan.recount.threadStarterIds = [
        ...new Set(plan.deletes.chatMessageDocs.map((m) => m.threadId).filter(Boolean).map(str)),
    ].filter((id) => !deletedMessages.has(id));
    // Their emoji reactions on other people's messages.
    for (const m of await findAll("chatMessageDocs", { "reactions.userDid": inDids })) {
        update("chatMessageDocs", m, {
            reactions: (m.reactions ?? []).filter((r: any) => !didSet.has(r?.userDid)),
        });
    }
    const rooms = del("chatRooms", await findAll("chatRooms", { $or: [{ circleId: inOwn }, { dmParticipants: inDids }] }));
    del("chatReadStates", await findAll("chatReadStates", { $or: [{ userDid: inDids }, { conversationId: { $in: idVariants(conversationIds) } }] }));
    del(
        "chatRoomMembers",
        await findAll("chatRoomMembers", {
            $or: [{ userDid: inDids }, { chatRoomId: { $in: idVariants([...conversationIds, ...strs(rooms)]) } }],
        }),
    );
    del(
        "messageEmailReminders",
        await findAll("messageEmailReminders", {
            $or: [
                { senderDid: inDids },
                { recipientDid: inDids },
                { messageId: { $in: idVariants(messageIds) } },
                { conversationId: { $in: idVariants(conversationIds) } },
            ],
        }),
    );

    // --- Reactions: theirs, and every reaction on something deleted ----------------------------
    const reactionRows = del(
        "reactions",
        await findAll("reactions", {
            $or: [
                { userDid: inDids },
                { contentType: "post", contentId: { $in: postIds } },
                { contentType: "comment", contentId: { $in: commentIds } },
                { contentType: "proposal", contentId: { $in: proposalIds } },
                { contentType: "track", contentId: { $in: trackIds } },
                { contentType: "chatMessage", contentId: { $in: messageIds } },
            ],
        }),
    );

    // --- Events: their RSVPs/invitations/host requests, and those of deleted events -------------
    const inEvents = { $in: idVariants(eventIds) };
    del("eventRsvps", await findAll("eventRsvps", { $or: [{ eventId: inEvents }, { userDid: inDids }] }));
    del("eventInvitations", await findAll("eventInvitations", { $or: [{ eventId: inEvents }, { userDid: inDids }] }));
    del(
        "eventHostChangeRequests",
        await findAll("eventHostChangeRequests", {
            $or: [{ eventId: inEvents }, { requestedBy: inDids }, { fromCircleId: inOwn }, { toCircleId: inOwn }],
        }),
    );
    for (const e of await findAll("events", {
        $or: [
            { invitations: inDids },
            { additionalArtistCircleIds: inOwn },
            { artistAdminCircleIds: inOwn },
            { "metadata.peerify.venueCircleId": inOwn },
        ],
    })) {
        const set: Fields = {};
        if (Array.isArray(e.invitations)) set.invitations = dropDids(e.invitations);
        if (Array.isArray(e.additionalArtistCircleIds)) set.additionalArtistCircleIds = dropOwn(e.additionalArtistCircleIds);
        if (Array.isArray(e.artistAdminCircleIds)) set.artistAdminCircleIds = dropOwn(e.artistAdminCircleIds);
        if (ownSet.has(str(e.metadata?.peerify?.venueCircleId ?? ""))) {
            const { venueCircleId: _drop, ...peerify } = e.metadata.peerify;
            set.metadata = { ...e.metadata, peerify };
        }
        update("events", e, set);
    }

    // --- Tasks, issues and goals of other people that reference them ----------------------------
    const TASK_UNSET = ["assignedTo", "acceptedBy"];
    const TASK_MARK = ["submittedForReviewBy", "reviewRequestedChangesBy", "claimApprovedBy", "verifiedBy"];
    for (const t of await findAll("tasks", {
        $or: [
            ...[...TASK_UNSET, ...TASK_MARK].map((f) => ({ [f]: inDids })),
            { "claims.claimantDid": inDids },
            { "claims.reviewedBy": inDids },
            { "participants.userDid": inDids },
            { "participants.verifiedBy": inDids },
            { "participants.attendanceVerifiedBy": inDids },
        ],
    })) {
        const set: Fields = {};
        const unset = TASK_UNSET.filter((f) => didSet.has(t[f]));
        for (const f of TASK_MARK) if (didSet.has(t[f])) set[f] = DELETED_USER_DID;
        const mark = (v: unknown) => (didSet.has(v as string) ? DELETED_USER_DID : v);
        if (Array.isArray(t.claims)) {
            set.claims = t.claims
                .filter((c: any) => !didSet.has(c?.claimantDid))
                .map((c: any) => (c && didSet.has(c.reviewedBy) ? { ...c, reviewedBy: DELETED_USER_DID } : c));
        }
        if (Array.isArray(t.participants)) {
            set.participants = t.participants
                .filter((p: any) => !didSet.has(p?.userDid))
                .map((p: any) =>
                    p ? { ...p, ...(p.verifiedBy ? { verifiedBy: mark(p.verifiedBy) } : {}), ...(p.attendanceVerifiedBy ? { attendanceVerifiedBy: mark(p.attendanceVerifiedBy) } : {}) } : p,
                );
        }
        update("tasks", t, set, unset);
    }
    for (const i of await findAll("issues", { assignedTo: inDids })) update("issues", i, {}, ["assignedTo"]);
    for (const g of await findAll("goals", { followers: inDids })) update("goals", g, { followers: dropDids(g.followers) });
    del("goalMembers", await findAll("goalMembers", { $or: [{ userId: uid }, { goalId: { $in: idVariants(goalIds) } }] }));
    const rankedLists = del("rankedLists", await findAll("rankedLists", { $or: [{ userId: uid }, { entityId: inOwn }] }));
    // Cached aggregates are recomputed on the next read once their row is gone.
    del(
        "aggregateRanks",
        await findAll("aggregateRanks", {
            entityId: { $in: idVariants([...new Set([...rankedLists.map((l) => str(l.entityId)), ...own])]) },
        }),
    );

    // --- Notifications: theirs, by them, about them, or about anything deleted -----------------
    const inPosts = { $in: idVariants(postIds) };
    const inComments = { $in: idVariants(commentIds) };
    del(
        "notifications",
        await findAll("notifications", {
            $or: [
                { userId: inDids },
                { actorDid: inDids },
                { "content.user.did": inDids },
                { "content.post.createdBy": inDids },
                { "content.comment.createdBy": inDids },
                { "content.postId": inPosts },
                { "content.post._id": inPosts },
                { "content.commentId": inComments },
                { "content.comment._id": inComments },
                { "content.eventId": inEvents },
                { "content.event._id": inEvents },
                { "content.trackId": { $in: idVariants(trackIds) } },
                { "content.proposalId": { $in: idVariants(proposalIds) } },
                { "content.circle._id": inOwn },
                { "content.circleId": inOwn },
            ],
        }),
    );
    del("pushSubscriptions", await findAll("pushSubscriptions", { userId: inDids }));
    del("userNotificationSettings", await findAll("userNotificationSettings", { $or: [{ userId: inDids }, { entityId: inOwn }] }));
    del("userRelationships", await findAll("userRelationships", { $or: [{ fromDid: inDids }, { toDid: inDids }] }));

    // --- Verification, invitations, admin and circle-move requests, pledges ---------------------
    del("humanityVerifications", await findAll("humanityVerifications", { subjectDid: inDids }));
    for (const h of await findAll("humanityVerifications", { verifierDid: inDids })) {
        update("humanityVerifications", h, { verifierDid: DELETED_USER_DID });
    }
    const verifications = del(
        "verifications",
        await findAll("verifications", { $or: [{ userDid: inDids }, { targetCircleId: inOwn }] }),
    );
    for (const v of await findAll("verifications", { reviewedBy: inDids })) {
        update("verifications", v, { reviewedBy: DELETED_USER_DID });
    }
    del(
        "verificationMessages",
        await findAll("verificationMessages", {
            $or: [{ requestId: { $in: idVariants(strs(verifications)) } }, { senderDid: inDids }],
        }),
    );
    del(
        "adminInvitations",
        await findAll("adminInvitations", {
            $or: [{ invitedUserDid: inDids }, { invitedByUserDid: inDids }, { circleId: inOwn }],
        }),
    );
    del(
        "adminRoleRemovalRequests",
        await findAll("adminRoleRemovalRequests", {
            $or: [{ targetUserDid: inDids }, { requestedByDid: inDids }, { circleId: inOwn }],
        }),
    );
    del(
        "detachCircleRequests",
        await findAll("detachCircleRequests", {
            $or: [{ requestedByDid: inDids }, { circleId: inOwn }, { parentCircleId: inOwn }],
        }),
    );
    for (const r of await findAll("detachCircleRequests", {
        $or: [{ requiredAdminDids: inDids }, { approvedByDids: inDids }],
    })) {
        update("detachCircleRequests", r, {
            ...(Array.isArray(r.requiredAdminDids) ? { requiredAdminDids: dropDids(r.requiredAdminDids) } : {}),
            ...(Array.isArray(r.approvedByDids) ? { approvedByDids: dropDids(r.approvedByDids) } : {}),
        });
    }
    del(
        "attachCircleRequests",
        await findAll("attachCircleRequests", {
            $or: [
                { requestedByDid: inDids },
                { circleId: inOwn },
                { fromParentCircleId: inOwn },
                { toParentCircleId: inOwn },
            ],
        }),
    );
    for (const r of await findAll("attachCircleRequests", { approvedByDid: inDids })) {
        update("attachCircleRequests", r, { approvedByDid: DELETED_USER_DID });
    }
    del("peerify_pledges", await findAll("peerify_pledges", { $or: [{ pledgerDid: inDids }, { artistCircleId: inOwn }] }));
    if (email) del("capturedEmails", await findAll("capturedEmails", { to: email }));
    // Pop-up and private spaces (lib/data/space.ts): the person's own, deleted outright.
    del("spaces", await findAll("spaces", { ownerDid: inDids }));

    // --- Other circles that point at them -------------------------------------------------------
    for (const c of await findAll("circles", {
        $or: [
            { bookmarkedCircles: inOwn },
            { pinnedCircles: inOwn },
            { ignoredCircles: inOwn },
            { createdBy: inDids },
            { verifiedBy: inDids },
            { featuredTrackId: { $in: idVariants(trackIds) } },
            { parentCircleId: inOwn },
        ],
    })) {
        if (ownSet.has(str(c._id))) continue;
        const set: Fields = {};
        const unset: string[] = [];
        for (const f of ["bookmarkedCircles", "pinnedCircles", "ignoredCircles"]) {
            if (Array.isArray(c[f])) set[f] = dropOwn(c[f]);
        }
        if (didSet.has(c.createdBy)) set.createdBy = DELETED_USER_DID;
        if (didSet.has(c.verifiedBy)) set.verifiedBy = DELETED_USER_DID;
        if (c.featuredTrackId && trackIds.includes(str(c.featuredTrackId))) unset.push("featuredTrackId");
        if (c.parentCircleId && ownSet.has(str(c.parentCircleId))) unset.push("parentCircleId");
        update("circles", c, set, unset);
    }
    // Structured mentions of their circles in other people's posts/comments (the text is left).
    for (const name of ["posts", "comments"] as const) {
        for (const d of await findAll(name, { "mentions.id": inOwn })) {
            update(name, d, { mentions: d.mentions.filter((m: any) => !ownSet.has(str(m?.id))) });
        }
    }

    // The circles themselves; the account row is deleted last by applyAccountErasure.
    del("circles", [...ownArtists, user]);

    // --- Counters to recount on what is left ----------------------------------------------------
    const deletedPostSet = new Set(postIds);
    const deletedCommentSet = new Set(commentIds);
    plan.recount.postIds = [
        ...new Set([
            ...plan.deletes.comments.map((c) => c.postId).filter(Boolean).map(str),
            ...reactionRows.filter((r) => r.contentType === "post").map((r) => str(r.contentId)),
        ]),
    ].filter((id) => !deletedPostSet.has(id));
    plan.recount.commentIds = [
        ...new Set([
            ...plan.deletes.comments.map((c) => c.parentCommentId).filter(Boolean).map(str),
            ...reactionRows.filter((r) => r.contentType === "comment").map((r) => str(r.contentId)),
        ]),
    ].filter((id) => !deletedCommentSet.has(id));
    plan.recount.proposalIds = notIn(
        [...new Set(reactionRows.filter((r) => r.contentType === "proposal").map((r) => str(r.contentId)))],
        new Set(proposalIds),
    );
    plan.recount.trackIds = notIn(
        [...new Set(plan.deletes.comments.map((c) => c.trackId).filter(Boolean).map(str))],
        new Set(trackIds),
    );
    // Recounts an earlier run stored but didn't get to (its deletes cut the links that found them).
    const pending = user.erasurePendingRecount;
    if (pending && typeof pending === "object") {
        for (const key of Object.keys(plan.recount) as (keyof ErasurePlan["recount"])[]) {
            if (Array.isArray(pending[key])) {
                plan.recount[key] = [...new Set([...plan.recount[key], ...pending[key].map(str)])];
            }
        }
    }

    // --- Files ----------------------------------------------------------------------------------
    plan.files.publicPrefixes = own.map((id) => `${id}/`);
    plan.files.privatePrefixes = own.map((id) => `audio/${id}/`);
    const keys = new Set<string>();
    for (const name of ERASURE_COLLECTIONS) {
        for (const doc of plan.deletes[name]) {
            for (const url of fileUrlsOf(name, doc)) {
                const key = storageKeyFromUrl(url);
                if (key) keys.add(key);
            }
        }
    }
    plan.files.publicKeys = [...keys];
    plan.files.privateKeys = plan.deletes.tracks
        .flatMap((t) => [t.originalKey, t.previewKey])
        .filter((k): k is string => typeof k === "string" && !!k);

    return plan;
}

const reactionCounts = async (contentType: string, contentId: string): Promise<Record<string, number>> => {
    const counts: Record<string, number> = {};
    for (const r of await findAll("reactions", { contentType, contentId })) {
        counts[r.reactionType] = (counts[r.reactionType] ?? 0) + 1;
    }
    return counts;
};
const byId = (id: string) => ({ _id: ObjectId.isValid(id) ? new ObjectId(id) : id });

export async function applyAccountErasure(plan: ErasurePlan): Promise<ErasureResult> {
    const result: ErasureResult = {
        did: plan.did,
        found: plan.found,
        deleted: {},
        updated: {},
        files: { public: 0, private: 0 },
        recounted: 0,
        vdbErrors: [],
        userDirRemoved: false,
    };
    if (!plan.found || !plan.userCircleId) return result;
    const tag = `[ERASURE ${plan.did.slice(0, 8)}…]`;

    // 1. Mark the account, so a run that stops halfway is visible on the row itself, and store the
    //    recounts: once comments/reactions are deleted, a rerun could no longer find what to recount.
    await col("circles").updateOne(byId(plan.userCircleId), {
        $set: { erasureStartedAt: new Date(), erasurePendingRecount: plan.recount },
    });

    // 2. Files first: their keys come from rows that are deleted below, so on a rerun they are
    //    still findable. A storage failure stops the run here, before any row is gone.
    const publicKeys = new Set(plan.files.publicKeys);
    for (const prefix of plan.files.publicPrefixes) {
        for (const key of await listObjectKeysByPrefix("public", prefix)) publicKeys.add(key);
    }
    const privateKeys = new Set(plan.files.privateKeys);
    for (const prefix of plan.files.privatePrefixes) {
        for (const key of await listObjectKeysByPrefix("private", prefix)) privateKeys.add(key);
    }
    result.files.public = await removeObjectKeys("public", [...publicKeys]);
    result.files.private = await removeObjectKeys("private", [...privateKeys]);

    // 3. Vector DB (best effort, like purge-unverified.ts: errors are reported, not thrown).
    for (const circleId of plan.ownCircleIds) {
        try {
            await deleteVbdCircle(circleId);
        } catch (err) {
            result.vdbErrors.push(`circle ${circleId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    for (const post of plan.deletes.posts) {
        try {
            await deleteVbdPost(str(post._id));
        } catch (err) {
            result.vdbErrors.push(`post ${str(post._id)}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // 4. References in other people's documents.
    for (const u of plan.updates) {
        const ops: Fields = {};
        if (u.set) ops.$set = u.set;
        if (u.unset?.length) ops.$unset = Object.fromEntries(u.unset.map((f) => [f, ""]));
        if (Object.keys(ops).length === 0) continue;
        await col(u.collection).updateOne({ _id: u._id }, ops);
        result.updated[u.collection] = (result.updated[u.collection] ?? 0) + 1;
    }

    // 5. Rows, children first; the account row is kept for last.
    for (const name of ERASURE_COLLECTIONS) {
        const ids = plan.deletes[name].map((d) => d._id).filter((id) => !(name === "circles" && str(id) === plan.userCircleId));
        if (ids.length === 0) continue;
        const res = await col(name).deleteMany({ _id: { $in: ids } });
        result.deleted[name] = res.deletedCount ?? 0;
    }

    // 6. Counters on what is left.
    for (const id of plan.recount.postIds) {
        const top = await col("comments")
            .find({ postId: id, parentCommentId: null })
            .sort({ "reactions.like": -1, createdAt: -1 })
            .limit(1)
            .toArray();
        const ops: Fields = {
            $set: {
                comments: await col("comments").countDocuments({ postId: id }),
                reactions: await reactionCounts("post", id),
                ...(top.length ? { highlightedCommentId: str(top[0]._id) } : {}),
            },
        };
        if (!top.length) ops.$unset = { highlightedCommentId: "" };
        await col("posts").updateOne(byId(id), ops);
        result.recounted++;
    }
    for (const id of plan.recount.commentIds) {
        await col("comments").updateOne(byId(id), {
            $set: {
                replies: await col("comments").countDocuments({ parentCommentId: id }),
                reactions: await reactionCounts("comment", id),
            },
        });
        result.recounted++;
    }
    for (const id of plan.recount.proposalIds) {
        await col("proposals").updateOne(byId(id), { $set: { reactions: await reactionCounts("proposal", id) } });
        result.recounted++;
    }
    for (const id of plan.recount.trackIds) {
        await col("tracks").updateOne(byId(id), {
            $set: { commentCount: await col("comments").countDocuments({ trackId: id, isDeleted: { $ne: true } }) },
        });
        result.recounted++;
    }
    for (const id of plan.recount.threadStarterIds) {
        const starter = await col("chatMessageDocs").findOne(byId(id));
        if (!starter?.thread) continue;
        const replyCount = await col("chatMessageDocs").countDocuments({ threadId: { $in: idVariants([id]) } });
        await col("chatMessageDocs").updateOne(byId(id), { $set: { thread: { ...starter.thread, replyCount } } });
        result.recounted++;
    }
    result.recounted += (await recountMemberCounters(plan.recount.memberCircleIds)).length;

    // 7. Key directory, then the account itself.
    result.userDirRemoved = removeUserKeyDir(plan.did);
    const last = await col("circles").deleteMany({ _id: { $in: idVariants([plan.userCircleId]) }, did: plan.did });
    result.deleted.circles = (result.deleted.circles ?? 0) + (last.deletedCount ?? 0);

    const nonZero = (counts: Record<string, number>) =>
        Object.entries(counts)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k}=${n}`)
            .join(" ");
    console.log(`${tag} deleted: ${nonZero(result.deleted) || "nothing"}`);
    console.log(`${tag} updated: ${nonZero(result.updated) || "nothing"}`);
    console.log(
        `${tag} files: public=${result.files.public} private=${result.files.private}; recounted=${result.recounted}; key dir removed=${result.userDirRemoved}`,
    );
    if (result.vdbErrors.length) console.warn(`${tag} vector DB errors (${result.vdbErrors.length}):`, result.vdbErrors);
    return result;
}

export async function eraseAccount(did: string): Promise<ErasureResult> {
    return applyAccountErasure(await planAccountErasure(did));
}
