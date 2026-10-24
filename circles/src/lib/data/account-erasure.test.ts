// Run: bun test src/lib/data/account-erasure.test.ts
// The database is a set of in-memory fake collections, both storage buckets in-memory sets, the
// vector DB a spy and USERS_DIR a temp directory, so nothing real is touched.
//
// Alice (A) is erased. She has rows in every collection, an auto-created artist circle of her own
// (ART), and is co-admin of Bob's artist circle (CO). Bob (B) and Carol (C) have their own content,
// some of it pointing at Alice. After erasure no document may contain Alice's DID, email or circle
// ids (mention markup inside other people's text excepted), no file may remain under her prefixes,
// and everything of Bob's and Carol's that doesn't hang off Alice's content must be unchanged.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { ObjectId } from "mongodb";
import { createFakeCollection, type FakeCollection } from "@/lib/testing/fake-collection";

const NAMES = [
    "circles",
    "members",
    "membershipRequests",
    "crewApplications",
    "adminInvitations",
    "feeds",
    "posts",
    "comments",
    "reactions",
    "chatRooms",
    "chatRoomMembers",
    "proposals",
    "issues",
    "tasks",
    "tracks",
    "fundingAsks",
    "goals",
    "events",
    "eventRsvps",
    "eventInvitations",
    "eventHostChangeRequests",
    "goalMembers",
    "rankedLists",
    "aggregateRanks",
    "userNotificationSettings",
    "notifications",
    "pushSubscriptions",
    "chatConversations",
    "chatMessageDocs",
    "chatReadStates",
    "messageEmailReminders",
    "userRelationships",
    "humanityVerifications",
    "capturedEmails",
    "verifications",
    "verificationMessages",
    "adminRoleRemovalRequests",
    "detachCircleRequests",
    "attachCircleRequests",
    "peerify_pledges",
    "spaces",
] as const;
type Name = (typeof NAMES)[number];
let cols = {} as Record<Name, FakeCollection>;
const reset = () => {
    cols = Object.fromEntries(NAMES.map((n) => [n, createFakeCollection()])) as typeof cols;
};
reset();

const wrap = (n: Name) => ({
    find: (...a: any[]) => (cols[n] as any).find(...a),
    findOne: (...a: any[]) => (cols[n] as any).findOne(...a),
    countDocuments: (...a: any[]) => (cols[n] as any).countDocuments(...a),
    deleteMany: (...a: any[]) => (cols[n] as any).deleteMany(...a),
    updateOne: (...a: any[]) => (cols[n] as any).updateOne(...a),
});
// purge-unverified.ts uses the named exports (Circles, Members, …); account-erasure.ts uses
// db.collection(name). Both read the current fakes.
const dbProxy: Record<string, unknown> = {
    db: { collection: (n: Name) => wrap(n) },
    ...Object.fromEntries(NAMES.map((n) => [n[0].toUpperCase() + n.slice(1), wrap(n)])),
};
mock.module("./db", () => dbProxy);
mock.module("@/lib/data/db", () => dbProxy);

const vdbDeleted: string[] = [];
mock.module("./vdb", () => ({
    deleteVbdCircle: async (id: string) => void vdbDeleted.push(`circle:${id}`),
    deleteVbdPost: async (id: string) => void vdbDeleted.push(`post:${id}`),
}));

const buckets = { public: new Set<string>(), private: new Set<string>() };
mock.module("./storage", () => ({
    listObjectKeysByPrefix: async (bucket: "public" | "private", prefix: string) => {
        if (!prefix || !prefix.endsWith("/")) throw new Error(`bad prefix ${prefix}`);
        return [...buckets[bucket]].filter((k) => k.startsWith(prefix));
    },
    removeObjectKeys: async (bucket: "public" | "private", keys: string[]) => {
        const unique = [...new Set(keys)];
        for (const k of unique) buckets[bucket].delete(k);
        return unique.length;
    },
}));

const USERS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "erasure-users-"));
mock.module("../auth/auth", () => ({ USERS_DIR }));
mock.module("@/lib/auth/auth", () => ({ USERS_DIR }));

const { eraseAccount, planAccountErasure, DELETED_USER_DID } = await import("./account-erasure");

const A = "did:alice:aaaaaaaaaaaa";
const ART_DID = "did:alice-artist:aaaaaaa";
const B = "did:bob:bbbbbbbbbbbbbb";
const C = "did:carol:cccccccccccc";
const EMAIL = "alice@example.test";

const oid = () => new ObjectId();
const A_ID = oid();
const ART_ID = oid();
const CO_ID = oid();
const B_ID = oid();
const V_ID = oid();
const ids = {} as Record<string, ObjectId>;
const id = (name: string) => (ids[name] ??= oid());
const s = (o: ObjectId) => String(o);

function seed() {
    reset();
    for (const k of Object.keys(ids)) delete ids[k];
    buckets.public.clear();
    buckets.private.clear();
    vdbDeleted.length = 0;
    fs.mkdirSync(path.join(USERS_DIR, A), { recursive: true });
    fs.mkdirSync(path.join(USERS_DIR, B), { recursive: true });

    const d = cols;
    d.circles.docs.push(
        {
            _id: A_ID,
            did: A,
            handle: "alice",
            name: "Alice",
            email: EMAIL,
            circleType: "user",
            picture: { url: `/storage/${s(A_ID)}/picture1700.png` },
            tourTeamOfferings: [{ title: "Sound", photos: [{ url: `/storage/${s(A_ID)}/offer1700.jpg` }] }],
        },
        {
            _id: ART_ID,
            did: ART_DID,
            handle: "alice-band",
            circleType: "circle",
            createdBy: A,
            metadata: { peerify: { autoProvisionedFromSignup: true } },
            picture: { url: `/storage/${s(ART_ID)}/picture1700.png` },
        },
        { _id: CO_ID, did: "did:co:1", handle: "bob-and-alice", circleType: "circle", createdBy: B, featuredTrackId: s(id("coTrack")), members: 2 },
        { _id: B_ID, did: B, handle: "bob", email: "bob@example.test", circleType: "user", bookmarkedCircles: [s(A_ID), s(V_ID)], pinnedCircles: [s(A_ID)] },
        { _id: V_ID, did: "did:venue:1", handle: "venue", circleType: "circle", createdBy: B, verifiedBy: A, members: 3 },
    );
    d.members.docs.push(
        { _id: oid(), userDid: A, circleId: s(A_ID), userGroups: ["admins"] },
        { _id: oid(), userDid: A, circleId: s(ART_ID), userGroups: ["admins"] },
        { _id: oid(), userDid: A, circleId: s(CO_ID), userGroups: ["admins"] },
        { _id: oid(), userDid: B, circleId: s(CO_ID), userGroups: ["admins"] },
        { _id: oid(), userDid: A, circleId: s(V_ID), userGroups: ["members"] },
        { _id: oid(), userDid: B, circleId: s(V_ID), userGroups: ["admins"] },
        { _id: oid(), userDid: C, circleId: s(V_ID), userGroups: ["members"] },
        { _id: oid(), userDid: B, circleId: s(A_ID), userGroups: ["followers"] },
    );
    d.membershipRequests.docs.push({ _id: oid(), userDid: A, circleId: s(V_ID) }, { _id: id("cReq"), userDid: C, circleId: s(V_ID) });
    d.crewApplications.docs.push({ _id: oid(), userDid: A, circleId: s(V_ID), message: "hire me" });
    d.feeds.docs.push(
        { _id: id("aFeed"), circleId: s(A_ID) },
        { _id: id("artFeed"), circleId: s(ART_ID) },
        { _id: id("vFeed"), circleId: s(V_ID) },
    );

    // Events: Alice's own, one she created at the venue, and Bob's that invites her.
    d.events.docs.push(
        { _id: id("aEvent"), circleId: s(A_ID), createdBy: A, commentPostId: s(id("aEventShadow")), images: [{ fileInfo: { url: `/storage/${s(A_ID)}/event1700.png` } }] },
        { _id: id("aEventAtV"), circleId: s(V_ID), createdBy: A, images: [{ fileInfo: { url: `/storage/${s(V_ID)}/aliceevent1700.png` } }] },
        { _id: id("bEvent"), circleId: s(V_ID), createdBy: B, invitations: [A, B], additionalArtistCircleIds: [s(ART_ID), s(CO_ID)], metadata: { peerify: { venueCircleId: s(V_ID) } } },
    );
    d.eventRsvps.docs.push(
        { _id: oid(), eventId: s(id("aEvent")), userDid: B },
        { _id: oid(), eventId: s(id("bEvent")), userDid: A },
        { _id: id("cRsvp"), eventId: s(id("bEvent")), userDid: C },
    );
    d.eventInvitations.docs.push({ _id: oid(), eventId: s(id("bEvent")), userDid: A });
    d.eventHostChangeRequests.docs.push({ _id: oid(), eventId: s(id("bEvent")), requestedBy: A, fromCircleId: s(V_ID), toCircleId: s(CO_ID) });

    // Posts
    d.posts.docs.push(
        { _id: id("aPost"), feedId: s(id("aFeed")), createdBy: A, comments: 2, reactions: { like: 1 }, media: [{ fileInfo: { url: `/storage/${s(A_ID)}/feeds/x/img1700.png` } }] },
        { _id: id("aPostAtV"), feedId: s(id("vFeed")), createdBy: A, media: [{ fileInfo: { url: `/storage/${s(V_ID)}/feeds/y/alice1700.png` } }] },
        { _id: id("bPostInAFeed"), feedId: s(id("aFeed")), createdBy: B },
        { _id: id("aEventShadow"), feedId: s(id("vFeed")), createdBy: B, parentItemType: "event" },
        { _id: id("bPost"), feedId: s(id("vFeed")), createdBy: B, content: `hi [Alice](/circles/${s(A_ID)})`, mentions: [{ type: "circle", id: s(A_ID) }, { type: "circle", id: s(V_ID) }], comments: 3, reactions: { like: 1 }, highlightedCommentId: s(id("aComment")) },
        { _id: id("cPost"), feedId: s(id("vFeed")), createdBy: C, comments: 0, reactions: {} },
    );
    d.comments.docs.push(
        { _id: oid(), postId: s(id("aPost")), parentCommentId: null, createdBy: B },
        { _id: id("aComment"), postId: s(id("bPost")), parentCommentId: null, createdBy: A, reactions: { like: 2 }, replies: 1, author: { did: A, email: EMAIL } },
        { _id: id("bReplyToA"), postId: s(id("bPost")), parentCommentId: s(id("aComment")), createdBy: B, reactions: {} },
        { _id: id("bComment"), postId: s(id("bPost")), parentCommentId: null, createdBy: B, reactions: { like: 1 }, replies: 0 },
        { _id: oid(), trackId: s(id("coTrack")), parentCommentId: null, createdBy: A },
        { _id: id("cTrackComment"), trackId: s(id("coTrack")), parentCommentId: null, createdBy: C },
    );
    d.reactions.docs.push(
        { _id: oid(), contentType: "post", contentId: s(id("bPost")), userDid: A, reactionType: "like" },
        { _id: oid(), contentType: "post", contentId: s(id("aPost")), userDid: B, reactionType: "like" },
        { _id: oid(), contentType: "comment", contentId: s(id("bComment")), userDid: A, reactionType: "like" },
        { _id: oid(), contentType: "comment", contentId: s(id("aComment")), userDid: B, reactionType: "like" },
        { _id: oid(), contentType: "track", contentId: s(id("coTrack")), userDid: A, reactionType: "ovation", count: 5 },
        { _id: oid(), contentType: "proposal", contentId: s(id("bProposal")), userDid: A, reactionType: "like" },
        { _id: id("cReaction"), contentType: "proposal", contentId: s(id("bProposal")), userDid: C, reactionType: "like" },
    );

    // Tracks: one in Alice's own artist circle (deleted), one in Bob's co-run circle (kept).
    d.tracks.docs.push(
        { _id: id("artTrack"), artistProfileId: s(ART_ID), createdBy: A, originalKey: `audio/${s(ART_ID)}/t1/original.mp3`, previewKey: `audio/${s(ART_ID)}/t1/preview.mp3` },
        { _id: id("coTrack"), artistProfileId: s(CO_ID), createdBy: A, originalKey: `audio/${s(CO_ID)}/t2/original.mp3`, previewKey: `audio/${s(CO_ID)}/t2/preview.mp3`, commentCount: 2 },
    );

    // Chat
    d.chatConversations.docs.push(
        { _id: id("dm"), handle: "dm-x", participants: [A, B], dmGrants: [{ kind: "crew", grantedBy: A, circleId: s(V_ID) }, { kind: "crew", grantedBy: B, circleId: s(V_ID) }] },
        { _id: id("dmOnlyAlice"), handle: "dm-y", participants: [A, B] },
        { _id: id("booking"), handle: `peerify-booking-${s(V_ID)}-${A}-1`, participants: [A, B], metadata: { bookerDid: A, bookerName: "Alice" } },
        { _id: id("welcome"), handle: `welcome-${A}`, participants: [A] },
        { _id: id("group"), handle: "venue-group", circleId: s(V_ID), participants: [A, B, C], picture: { url: `/storage/${s(V_ID)}/group1700.png` } },
    );
    d.chatMessageDocs.docs.push(
        { _id: oid(), conversationId: s(id("dm")), senderDid: A, body: "hey", attachments: [{ url: `/storage/${s(A_ID)}/chat1700.png` }] },
        { _id: id("bDmMsg"), conversationId: s(id("dm")), senderDid: B, body: "hi", reactions: [{ emoji: "👍", userDid: A }, { emoji: "🎸", userDid: B }] },
        { _id: oid(), conversationId: s(id("dmOnlyAlice")), senderDid: A, body: "anyone?" },
        { _id: oid(), conversationId: s(id("booking")), senderDid: B, body: "sure, Friday" },
        { _id: oid(), conversationId: s(id("welcome")), senderDid: "did:system:1", body: "welcome" },
        { _id: id("aThread"), conversationId: s(id("group")), senderDid: A, body: "gig?", thread: { title: "gig", replyCount: 1 } },
        { _id: oid(), conversationId: s(id("group")), senderDid: B, body: "yes", threadId: s(id("aThread")) },
        { _id: id("bThread"), conversationId: s(id("group")), senderDid: B, body: "setlist", thread: { title: "setlist", replyCount: 2 } },
        { _id: oid(), conversationId: s(id("group")), senderDid: A, body: "song 1", threadId: s(id("bThread")) },
        { _id: id("cThreadReply"), conversationId: s(id("group")), senderDid: C, body: "song 2", threadId: s(id("bThread")) },
    );
    d.chatReadStates.docs.push(
        { _id: oid(), userDid: A, conversationId: s(id("dm")) },
        { _id: oid(), userDid: B, conversationId: s(id("dmOnlyAlice")) },
        { _id: id("bReadDm"), userDid: B, conversationId: s(id("dm")) },
    );
    d.chatRoomMembers.docs.push({ _id: oid(), userDid: A, chatRoomId: s(id("group")) });
    d.chatRooms.docs.push({ _id: oid(), handle: `dm-${A}-${B}`, dmParticipants: [A, B] });
    d.messageEmailReminders.docs.push({ _id: oid(), senderDid: A, recipientDid: B, conversationId: s(id("dm")) });

    // Tasks, issues, goals, proposals, rankings, funding
    d.tasks.docs.push(
        { _id: oid(), circleId: s(V_ID), createdBy: A, images: [{ fileInfo: { url: `/storage/${s(V_ID)}/task1700.png` } }] },
        {
            _id: id("bTask"),
            circleId: s(V_ID),
            createdBy: B,
            assignedTo: A,
            verifiedBy: A,
            claims: [{ claimantDid: A }, { claimantDid: C, reviewedBy: A }],
            participants: [{ userDid: A }, { userDid: C, verifiedBy: A }],
        },
    );
    d.issues.docs.push({ _id: oid(), circleId: s(V_ID), createdBy: A }, { _id: id("bIssue"), circleId: s(V_ID), createdBy: B, assignedTo: A });
    d.goals.docs.push({ _id: id("aGoal"), circleId: s(V_ID), createdBy: A }, { _id: id("bGoal"), circleId: s(V_ID), createdBy: B, followers: [A, B] });
    d.goalMembers.docs.push({ _id: oid(), userId: s(A_ID), goalId: s(id("bGoal")) }, { _id: oid(), userId: s(B_ID), goalId: s(id("aGoal")) });
    d.proposals.docs.push({ _id: oid(), circleId: s(V_ID), createdBy: A }, { _id: id("bProposal"), circleId: s(V_ID), createdBy: B, reactions: { like: 2 } });
    d.rankedLists.docs.push({ _id: oid(), userId: s(A_ID), entityId: s(V_ID), list: [] }, { _id: id("bList"), userId: s(B_ID), entityId: s(CO_ID), list: [] });
    d.aggregateRanks.docs.push({ _id: oid(), entityId: s(V_ID), rankMap: {} }, { _id: id("coRank"), entityId: s(CO_ID), rankMap: {} });
    d.fundingAsks.docs.push({ _id: oid(), circleId: s(V_ID), createdByDid: A, createdByHandleSnapshot: "alice", coverImage: { url: `/storage/${s(V_ID)}/funding1700.png` } });

    // Notifications and settings
    d.notifications.docs.push(
        { _id: oid(), userId: A, type: "x" },
        { _id: oid(), userId: B, actorDid: A, type: "follow" },
        { _id: oid(), userId: B, type: "legacy", content: { user: { did: A, name: "Alice" } } },
        { _id: oid(), userId: C, type: "comment", content: { postId: s(id("aPost")) } },
        { _id: id("cNotif"), userId: B, actorDid: C, type: "comment", content: { postId: s(id("bPost")) } },
    );
    d.pushSubscriptions.docs.push({ _id: oid(), userId: A, endpoint: "https://push.example/a" });
    d.userNotificationSettings.docs.push({ _id: oid(), userId: A, entityId: s(V_ID) }, { _id: oid(), userId: B, entityId: s(A_ID), entityType: "USER" });
    d.userRelationships.docs.push({ _id: oid(), fromDid: A, toDid: B }, { _id: oid(), fromDid: C, toDid: A }, { _id: id("bcRel"), fromDid: B, toDid: C });
    d.humanityVerifications.docs.push({ _id: oid(), subjectDid: A, verifierDid: B }, { _id: id("bVouchedByA"), subjectDid: B, verifierDid: A });
    d.verifications.docs.push({ _id: id("aVerif"), userDid: A, targetCircleId: s(A_ID) }, { _id: id("cVerif"), userDid: C, reviewedBy: A });
    d.verificationMessages.docs.push(
        { _id: oid(), requestId: s(id("aVerif")), senderDid: B, attachments: [{ url: `/storage/${s(A_ID)}/proof1700.pdf` }] },
        { _id: oid(), requestId: s(id("cVerif")), senderDid: A, body: "looks good" },
        { _id: id("cVerifMsg"), requestId: s(id("cVerif")), senderDid: C, body: "thanks" },
    );
    d.adminInvitations.docs.push({ _id: oid(), invitedUserDid: A, invitedByUserDid: B, circleId: s(V_ID) });
    d.adminRoleRemovalRequests.docs.push({ _id: oid(), targetUserDid: A, requestedByDid: B, circleId: s(CO_ID) });
    d.detachCircleRequests.docs.push({ _id: id("detach"), circleId: s(CO_ID), parentCircleId: s(V_ID), requestedByDid: B, requiredAdminDids: [A, B], approvedByDids: [A] });
    d.attachCircleRequests.docs.push({ _id: id("attach"), circleId: s(CO_ID), requestedByDid: B, approvedByDid: A });
    d.peerify_pledges.docs.push({ _id: oid(), pledgerDid: A, pledgerName: "Alice", artistCircleId: s(CO_ID) });
    d.capturedEmails.docs.push({ _id: oid(), to: EMAIL, templateModel: { name: "Alice" } }, { _id: id("bobMail"), to: "bob@example.test" });
    d.spaces.docs.push(
        { _id: oid(), ownerDid: A, type: "private", location: { precision: 2, city: "Lund", lngLat: { lng: 13.2, lat: 55.7 } }, notesForPeerify: "Alice's home" },
        { _id: oid(), ownerDid: A, type: "popup", name: "Alice's café" },
        { _id: id("bobSpace"), ownerDid: B, type: "popup", name: "Bob's café" },
    );

    for (const key of [
        `${s(A_ID)}/picture1700.png`,
        `${s(A_ID)}/offer1700.jpg`,
        `${s(A_ID)}/feeds/x/img1700.png`,
        `${s(A_ID)}/chat1700.png`,
        `${s(A_ID)}/event1700.png`,
        `${s(A_ID)}/proof1700.pdf`,
        `${s(A_ID)}/stray-no-row.png`,
        `${s(ART_ID)}/picture1700.png`,
        `${s(V_ID)}/feeds/y/alice1700.png`,
        `${s(V_ID)}/aliceevent1700.png`,
        `${s(V_ID)}/task1700.png`,
        `${s(V_ID)}/funding1700.png`,
        `${s(V_ID)}/group1700.png`,
        `${s(V_ID)}/bob1700.png`,
        `${s(B_ID)}/picture1700.png`,
    ]) {
        buckets.public.add(key);
    }
    for (const key of [
        `audio/${s(ART_ID)}/t1/original.mp3`,
        `audio/${s(ART_ID)}/t1/preview.mp3`,
        `audio/${s(CO_ID)}/t2/original.mp3`,
        `audio/${s(CO_ID)}/t2/preview.mp3`,
    ]) {
        buckets.private.add(key);
    }
}

// Every string in every document, with mention markup in other people's text removed.
const allStrings = (): { where: string; value: string }[] => {
    const out: { where: string; value: string }[] = [];
    const walk = (value: unknown, where: string) => {
        if (value instanceof ObjectId) out.push({ where, value: String(value) });
        else if (typeof value === "string") out.push({ where, value: value.replace(/\]\(\/circles\/[0-9a-f]{24}\)/g, "]()") });
        else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${where}[${i}]`));
        else if (value && typeof value === "object" && !(value instanceof Date)) {
            for (const [k, v] of Object.entries(value)) walk(v, `${where}.${k}`);
        }
    };
    for (const n of NAMES) for (const doc of cols[n].docs) walk(doc, `${n}/${String(doc._id)}`);
    return out;
};
const ALICE_MARKS = [A, ART_DID, EMAIL, s(A_ID), s(ART_ID)];
const find = (n: Name, oid_: ObjectId) => cols[n].docs.find((d) => String(d._id) === String(oid_));
const snapshot = () => JSON.stringify(NAMES.map((n) => cols[n].docs));

describe("eraseAccount", () => {
    beforeEach(seed);

    test("nothing anywhere references Alice afterwards, and no file is left under her prefixes", async () => {
        const result = await eraseAccount(A);
        expect(result.found).toBe(true);

        const leaks = allStrings().filter(({ value }) => ALICE_MARKS.some((m) => value.includes(m)));
        expect(leaks).toEqual([]);

        const publicLeft = [...buckets.public];
        expect(publicLeft.filter((k) => k.startsWith(`${s(A_ID)}/`) || k.startsWith(`${s(ART_ID)}/`))).toEqual([]);
        // Files of Alice's content stored under the venue's prefix go too; Bob's stay.
        expect(publicLeft.sort()).toEqual(
            [`${s(V_ID)}/bob1700.png`, `${s(V_ID)}/group1700.png`, `${s(B_ID)}/picture1700.png`].sort(),
        );
        // Audio of her own artist circle is gone; the co-run circle's song stays.
        expect([...buckets.private].sort()).toEqual(
            [`audio/${s(CO_ID)}/t2/original.mp3`, `audio/${s(CO_ID)}/t2/preview.mp3`].sort(),
        );
        expect(fs.existsSync(path.join(USERS_DIR, A))).toBe(false);
        expect(fs.existsSync(path.join(USERS_DIR, B))).toBe(true);
        expect(vdbDeleted).toContain(`circle:${s(A_ID)}`);
        expect(vdbDeleted).toContain(`circle:${s(ART_ID)}`);
        expect(vdbDeleted).toContain(`post:${s(id("aPost"))}`);
    });

    test("her spaces are deleted outright; Bob's stays", async () => {
        await eraseAccount(A);
        expect(cols.spaces.docs.map((d) => d.ownerDid)).toEqual([B]);
    });

    test("other people's content is kept, cleaned of references to her, with counters recounted", async () => {
        await eraseAccount(A);

        // Kept as-is (nothing of Alice's in them, nothing hanging off her content).
        for (const [n, key] of [
            ["membershipRequests", "cReq"],
            ["eventRsvps", "cRsvp"],
            ["reactions", "cReaction"],
            ["chatMessageDocs", "cThreadReply"],
            ["chatReadStates", "bReadDm"],
            ["rankedLists", "bList"],
            ["aggregateRanks", "coRank"],
            ["notifications", "cNotif"],
            ["userRelationships", "bcRel"],
            ["verificationMessages", "cVerifMsg"],
            ["capturedEmails", "bobMail"],
            ["spaces", "bobSpace"],
            ["comments", "cTrackComment"],
            ["posts", "cPost"],
        ] as [Name, string][]) {
            expect(find(n, id(key))).not.toBeUndefined();
        }

        // Bob's post: Alice's comment, the reply under it and her like are gone; counters follow.
        const bPost = find("posts", id("bPost"))!;
        expect(bPost.comments).toBe(1);
        expect(bPost.reactions).toEqual({});
        expect(bPost.highlightedCommentId).toBe(s(id("bComment")));
        expect(bPost.mentions).toEqual([{ type: "circle", id: s(V_ID) }]);
        expect(bPost.content).toBe(`hi [Alice](/circles/${s(A_ID)})`); // mention text left (Tim: default 6)
        expect(find("comments", id("bReplyToA"))).toBeUndefined();
        expect(find("comments", id("bComment"))!.reactions).toEqual({});
        expect(find("proposals", id("bProposal"))!.reactions).toEqual({ like: 1 });

        // The co-run circle's song stays, uploader replaced; its comment count drops to Carol's one.
        const coTrack = find("tracks", id("coTrack"))!;
        expect(coTrack.createdBy).toBe(DELETED_USER_DID);
        expect(coTrack.commentCount).toBe(1);
        expect(find("tracks", id("artTrack"))).toBeUndefined();
        expect(find("circles", CO_ID)!.featuredTrackId).toBe(s(id("coTrack")));

        // Chat: the DM with other messages stays without her; her reaction and grant go.
        const dm = find("chatConversations", id("dm"))!;
        expect(dm.participants).toEqual([B]);
        expect(dm.dmGrants).toEqual([{ kind: "crew", grantedBy: B, circleId: s(V_ID) }]);
        expect(find("chatMessageDocs", id("bDmMsg"))!.reactions).toEqual([{ emoji: "🎸", userDid: B }]);
        for (const gone of ["dmOnlyAlice", "booking", "welcome"]) expect(find("chatConversations", id(gone))).toBeUndefined();
        expect(find("chatConversations", id("group"))!.participants).toEqual([B, C]);
        expect(find("chatMessageDocs", id("aThread"))).toBeUndefined();
        expect(find("chatMessageDocs", id("bThread"))!.thread.replyCount).toBe(1);

        // Events, tasks, issues, goals: references removed, audit fields marked.
        const bEvent = find("events", id("bEvent"))!;
        expect(bEvent.invitations).toEqual([B]);
        expect(bEvent.additionalArtistCircleIds).toEqual([s(CO_ID)]);
        expect(find("events", id("aEventAtV"))).toBeUndefined();
        const bTask = find("tasks", id("bTask"))!;
        expect(bTask.assignedTo).toBeUndefined();
        expect(bTask.verifiedBy).toBe(DELETED_USER_DID);
        expect(bTask.claims).toEqual([{ claimantDid: C, reviewedBy: DELETED_USER_DID }]);
        expect(bTask.participants).toEqual([{ userDid: C, verifiedBy: DELETED_USER_DID }]);
        expect(find("issues", id("bIssue"))!.assignedTo).toBeUndefined();
        expect(find("goals", id("bGoal"))!.followers).toEqual([B]);

        // Verification and requests.
        expect(find("humanityVerifications", id("bVouchedByA"))!.verifierDid).toBe(DELETED_USER_DID);
        expect(find("verifications", id("cVerif"))!.reviewedBy).toBe(DELETED_USER_DID);
        const detach = find("detachCircleRequests", id("detach"))!;
        expect(detach.requiredAdminDids).toEqual([B]);
        expect(detach.approvedByDids).toEqual([]);
        expect(find("attachCircleRequests", id("attach"))!.approvedByDid).toBe(DELETED_USER_DID);

        // Circles: Bob's bookmarks/pins lose her; the venue's verifier is marked and its count recounted.
        const bob = find("circles", B_ID)!;
        expect(bob.bookmarkedCircles).toEqual([s(V_ID)]);
        expect(bob.pinnedCircles).toEqual([]);
        expect(find("circles", V_ID)!.verifiedBy).toBe(DELETED_USER_DID);
        expect(find("circles", V_ID)!.members).toBe(2);
        expect(find("circles", CO_ID)!.members).toBe(1);
        expect(find("circles", A_ID)).toBeUndefined();
        expect(find("circles", ART_ID)).toBeUndefined();
    });

    test("a second run finds nothing and changes nothing", async () => {
        await eraseAccount(A);
        const before = snapshot();
        const publicBefore = [...buckets.public].sort();
        const again = await eraseAccount(A);
        expect(again.found).toBe(false);
        expect(again.deleted).toEqual({});
        expect(again.files).toEqual({ public: 0, private: 0 });
        expect(snapshot()).toBe(before);
        expect([...buckets.public].sort()).toEqual(publicBefore);
    });

    test("a run that stopped halfway is finished by running it again, counters included", async () => {
        // Fail the first posts delete: files, references, reactions and comments are done by then.
        const realDeleteMany = cols.posts.deleteMany;
        let failed = false;
        cols.posts.deleteMany = async (filter: any) => {
            if (!failed) {
                failed = true;
                throw new Error("simulated crash");
            }
            return realDeleteMany(filter);
        };
        let threw = false;
        try {
            await eraseAccount(A);
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);
        expect(find("circles", A_ID)).not.toBeUndefined(); // the account row is still there to rerun from
        expect(find("comments", id("aComment"))).toBeUndefined();

        const again = await eraseAccount(A);
        expect(again.found).toBe(true);
        expect(allStrings().filter(({ value }) => ALICE_MARKS.some((m) => value.includes(m)))).toEqual([]);
        expect(find("posts", id("bPost"))!.comments).toBe(1);
        expect(find("posts", id("bPost"))!.highlightedCommentId).toBe(s(id("bComment")));
        expect(find("chatMessageDocs", id("bThread"))!.thread.replyCount).toBe(1);
        expect(find("circles", V_ID)!.members).toBe(2);
    });

    test("Bob and Carol's own unrelated content is byte-for-byte unchanged", async () => {
        const untouched = (n: Name, key: string) => JSON.stringify(find(n, id(key)));
        const keys: [Name, string][] = [
            ["posts", "cPost"],
            ["notifications", "cNotif"],
            ["userRelationships", "bcRel"],
            ["membershipRequests", "cReq"],
            ["chatMessageDocs", "cThreadReply"],
            ["verificationMessages", "cVerifMsg"],
            ["capturedEmails", "bobMail"],
        ];
        const before = keys.map(([n, k]) => untouched(n, k));
        await eraseAccount(A);
        expect(keys.map(([n, k]) => untouched(n, k))).toEqual(before);
    });

    test("an unknown did does nothing; a malformed one or the marker is refused", async () => {
        const before = snapshot();
        const r = await eraseAccount("did:nobody:zzzzzzzz");
        expect(r.found).toBe(false);
        expect(snapshot()).toBe(before);
        for (const bad of ["x", DELETED_USER_DID]) {
            let refused = false;
            try {
                await planAccountErasure(bad);
            } catch {
                refused = true;
            }
            expect(refused).toBe(true);
        }
    });
});
