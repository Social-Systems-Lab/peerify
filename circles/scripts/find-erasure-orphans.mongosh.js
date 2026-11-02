// DRY RUN ONLY (there is no apply mode). Lists rows that still point at an account or circle that no
// longer exists, i.e. what a delete left behind before account erasure (src/lib/data/account-erasure.ts)
// existed. For every field that holds a user DID or a circle id it prints how many rows reference a
// missing one, and up to 5 sample row _ids; it also checks a few parent links (a comment whose post
// is gone, a message whose conversation is gone, …). It prints counts, ids and the first 8
// characters of missing DIDs only: no names, no emails.
//
// Usage, from the repo root, with the read-only user:
//   (set -a; . /home/tim/.config/peerify/prod-ro.env; set +a; EXPECT_DB=circles mongosh --nodb --norc --quiet --file scripts/find-erasure-orphans.mongosh.js)
// EXPECT_DB must match the database the URI points at, so a wrong URI aborts.
//
// Files in object storage are checked by scripts/find-orphan-storage-prefixes.ts (mongosh can't
// reach MinIO).

// The URI is read from the environment, not passed on the command line, so the password
// never appears in argv (visible to every local user via ps).
if (!process.env.MONGODB_URI) {
    print("Refusing to run: MONGODB_URI is not set.");
    quit(1);
}
try {
    db = connect(process.env.MONGODB_URI);
} catch (e) {
    // Only the error's name: a parse error message can carry the URI.
    print(`Refusing to run: could not connect (${e && e.name}).`);
    quit(1);
}
const expectedDb = process.env.EXPECT_DB;
if (!expectedDb) {
    print("Refusing to run: set EXPECT_DB to the database name the URI points at.");
    quit(1);
}
if (db.getName() !== expectedDb) {
    print(`Refusing to run: connected to "${db.getName()}", EXPECT_DB is "${expectedDb}".`);
    quit(1);
}

// Values that are never a real account: the erasure marker, the comment-delete placeholder and
// the system actors (anything starting "system:", e.g. the system message sender and auto-verify). Reported separately, not as orphans.
const NOT_ACCOUNTS = new Set(["deleted-user", "anonymous", "system:auto-verified"]);

// In mongosh the projection is the plain second argument to find(), not {projection: …}.
const dids = new Set();
const circleIds = new Set();
db.getCollection("circles")
    .find({}, { did: 1 })
    .forEach((c) => {
        circleIds.add(String(c._id));
        if (c.did) dids.add(String(c.did));
    });
print(`Database: ${db.getName()}  (DRY RUN, read only)`);
print(`circles: ${circleIds.size}, of which with a did: ${dids.size}`);
print("");

// [collection, field, kind]. kind "did": must be some circle's did; "circle": some circle's _id.
// Dotted paths through arrays (claims.claimantDid) work: $project yields the array, $unwind splits it.
const FIELDS = [
    ["circles", "createdBy", "did"],
    ["circles", "verifiedBy", "did"],
    ["circles", "bookmarkedCircles", "circle"],
    ["circles", "pinnedCircles", "circle"],
    ["circles", "ignoredCircles", "circle"],
    ["circles", "parentCircleId", "circle"],
    ["members", "userDid", "did"],
    ["members", "circleId", "circle"],
    ["membershipRequests", "userDid", "did"],
    ["membershipRequests", "circleId", "circle"],
    ["crewApplications", "userDid", "did"],
    ["crewApplications", "circleId", "circle"],
    ["adminInvitations", "invitedUserDid", "did"],
    ["adminInvitations", "invitedByUserDid", "did"],
    ["feeds", "circleId", "circle"],
    ["posts", "createdBy", "did"],
    ["comments", "createdBy", "did"],
    ["reactions", "userDid", "did"],
    ["chatConversations", "participants", "did"],
    ["chatConversations", "metadata.bookerDid", "did"],
    ["chatConversations", "dmGrants.grantedBy", "did"],
    ["chatMessageDocs", "senderDid", "did"],
    ["chatMessageDocs", "reactions.userDid", "did"],
    ["chatReadStates", "userDid", "did"],
    ["chatRoomMembers", "userDid", "did"],
    ["chatRooms", "dmParticipants", "did"],
    ["chatRooms", "circleId", "circle"],
    ["events", "createdBy", "did"],
    ["events", "circleId", "circle"],
    ["events", "invitations", "did"],
    ["eventRsvps", "userDid", "did"],
    ["eventInvitations", "userDid", "did"],
    ["eventHostChangeRequests", "requestedBy", "did"],
    ["tasks", "createdBy", "did"],
    ["tasks", "assignedTo", "did"],
    ["tasks", "claims.claimantDid", "did"],
    ["tasks", "participants.userDid", "did"],
    ["issues", "createdBy", "did"],
    ["issues", "assignedTo", "did"],
    ["goals", "createdBy", "did"],
    ["goals", "followers", "did"],
    ["proposals", "createdBy", "did"],
    ["fundingAsks", "createdByDid", "did"],
    ["tracks", "createdBy", "did"],
    ["tracks", "artistProfileId", "circle"],
    ["goalMembers", "userId", "circle"],
    ["rankedLists", "userId", "circle"],
    ["notifications", "userId", "did"],
    ["notifications", "actorDid", "did"],
    ["notifications", "content.user.did", "did"],
    ["pushSubscriptions", "userId", "did"],
    ["userNotificationSettings", "userId", "did"],
    ["messageEmailReminders", "senderDid", "did"],
    ["messageEmailReminders", "recipientDid", "did"],
    ["userRelationships", "fromDid", "did"],
    ["userRelationships", "toDid", "did"],
    ["humanityVerifications", "subjectDid", "did"],
    ["humanityVerifications", "verifierDid", "did"],
    ["verifications", "userDid", "did"],
    ["verificationMessages", "senderDid", "did"],
    ["adminRoleRemovalRequests", "targetUserDid", "did"],
    ["adminRoleRemovalRequests", "requestedByDid", "did"],
    ["detachCircleRequests", "requestedByDid", "did"],
    ["detachCircleRequests", "requiredAdminDids", "did"],
    ["detachCircleRequests", "approvedByDids", "did"],
    ["attachCircleRequests", "requestedByDid", "did"],
    ["attachCircleRequests", "approvedByDid", "did"],
    ["peerify_pledges", "pledgerDid", "did"],
    ["peerify_pledges", "artistCircleId", "circle"],
    ["spaces", "ownerDid", "did"],
];

const existingCollections = new Set(db.getCollectionNames());
const short = (v) => `${String(v).slice(0, 8)}…`;
let totalRows = 0;
const notAccountCounts = {};

print("== References to a missing account (did) or circle (_id) ==");
for (const [name, field, kind] of FIELDS) {
    if (!existingCollections.has(name)) continue;
    const known = kind === "did" ? dids : circleIds;
    const groups = db
        .getCollection(name)
        .aggregate(
            [
                { $project: { v: `$${field}` } },
                { $unwind: "$v" },
                { $unwind: { path: "$v", preserveNullAndEmptyArrays: false } },
                { $match: { v: { $type: ["string", "objectId"] } } },
                { $group: { _id: "$v", rows: { $addToSet: "$_id" } } },
            ],
            { allowDiskUse: true },
        )
        .toArray();
    const missing = [];
    for (const g of groups) {
        const value = String(g._id);
        if (value === "") continue;
        if (NOT_ACCOUNTS.has(value) || value.startsWith("system:")) {
            notAccountCounts[`${name}.${field}=${value}`] = g.rows.length;
            continue;
        }
        if (!known.has(value)) missing.push(g);
    }
    if (missing.length === 0) continue;
    const rows = new Set();
    for (const g of missing) for (const r of g.rows) rows.add(String(r));
    totalRows += rows.size;
    const samples = [...rows].slice(0, 5).join(", ");
    const values = missing
        .slice(0, 5)
        .map((g) => short(g._id))
        .join(", ");
    print(`${name}.${field}: ${rows.size} rows, ${missing.length} missing ${kind === "did" ? "DIDs" : "circles"} (e.g. ${values})`);
    print(`    sample _ids: ${samples}`);
}
print("");

// Parent links: [child collection, field, parent collection, extra child filter].
const PARENTS = [
    ["posts", "feedId", "feeds", {}],
    ["comments", "postId", "posts", { postId: { $exists: true, $ne: null } }],
    ["comments", "trackId", "tracks", { trackId: { $exists: true, $ne: null } }],
    ["reactions", "contentId", "posts", { contentType: "post" }],
    ["reactions", "contentId", "comments", { contentType: "comment" }],
    ["reactions", "contentId", "tracks", { contentType: "track" }],
    ["reactions", "contentId", "proposals", { contentType: "proposal" }],
    ["chatMessageDocs", "conversationId", "chatConversations", {}],
    ["chatReadStates", "conversationId", "chatConversations", {}],
    ["eventRsvps", "eventId", "events", {}],
    ["eventInvitations", "eventId", "events", {}],
    ["verificationMessages", "requestId", "verifications", {}],
];
print("== Rows whose parent row is gone ==");
const idSets = {};
const idsOf = (name) => {
    if (!idSets[name]) {
        idSets[name] = new Set();
        if (existingCollections.has(name)) {
            db.getCollection(name)
                .find({}, { _id: 1 })
                .forEach((d) => idSets[name].add(String(d._id)));
        }
    }
    return idSets[name];
};
for (const [child, field, parent, filter] of PARENTS) {
    if (!existingCollections.has(child)) continue;
    const parents = idsOf(parent);
    const orphans = [];
    db.getCollection(child)
        .find(filter, { [field]: 1 })
        .forEach((d) => {
            const v = d[field];
            if (v !== undefined && v !== null && !parents.has(String(v))) orphans.push(String(d._id));
        });
    if (orphans.length === 0) continue;
    totalRows += orphans.length;
    print(`${child}.${field} -> ${parent}: ${orphans.length} rows (sample _ids: ${orphans.slice(0, 5).join(", ")})`);
}
print("");

const markers = Object.entries(notAccountCounts);
if (markers.length) {
    print("== Placeholder values (not orphans, for information) ==");
    for (const [k, n] of markers) print(`${k}: ${n} rows`);
    print("");
}
print(`Total orphaned row references: ${totalRows} (a row can be counted under more than one field).`);
print("Dry run only. Nothing was changed.");
