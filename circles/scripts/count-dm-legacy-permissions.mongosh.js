// Read-only counts for queue item 4, Batch B (new DMs require an accepted connection):
//   1. userRelationships edges by connectStatus, and by dmPermission/dmPermissionSource
//   2. legacy_dm edges by connectStatus
//   3. non-archived DM conversations by participant count
//   4. two-participant DM conversations by (has at least one message) x (connection state of the pair)
//   5. legacy_dm edges whose pair has a DM conversation with at least one message, vs. only an
//      empty one, vs. no DM conversation at all
//   6. two-participant DM conversations whose first message is before CUTOFF (if CUTOFF is set)
//
// Uses only countDocuments, find with projections, and aggregate. It never writes, and it prints
// counts only: no names, handles, emails, DIDs or ids.
//
// Usage (run from the repo root; each env file holds a MONGODB_URI that names its database):
//   Staging:
//     (set -a; . /home/tim/apps/peerify-staging/circles/.env.local; set +a; EXPECT_DB=peerify_staging mongosh --nodb --norc --quiet --file scripts/count-dm-legacy-permissions.mongosh.js)
//   Production (read-only user):
//     (set -a; . /home/tim/.config/peerify/prod-ro.env; set +a; EXPECT_DB=circles mongosh --nodb --norc --quiet --file scripts/count-dm-legacy-permissions.mongosh.js)
//
// EXPECT_DB must match the database the URI points at, so a wrong URI aborts instead of
// querying the wrong database. Optional CUTOFF (ISO date) adds count 6.

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
if (!expectedDb || db.getName() !== expectedDb) {
    print(`Aborting: connected to "${db.getName()}", EXPECT_DB is "${expectedDb || ""}"`);
    quit(1);
}
const cutoff = process.env.CUTOFF ? new Date(process.env.CUTOFF) : null;

const edges = db.getCollection("userRelationships");
const conversations = db.getCollection("chatConversations");
const messages = db.getCollection("chatMessageDocs");

print(`Database: ${db.getName()}`);
print(`\n1. userRelationships edges: ${edges.countDocuments({})}`);
edges.aggregate([{ $group: { _id: "$connectStatus", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).forEach((r) =>
    print(`   connectStatus ${r._id}: ${r.n}`),
);
edges
    .aggregate([
        { $group: { _id: { p: "$dmPermission", s: "$dmPermissionSource" }, n: { $sum: 1 } } },
        { $sort: { "_id.p": 1, "_id.s": 1 } },
    ])
    .forEach((r) => print(`   dmPermission ${r._id.p} / source ${r._id.s}: ${r.n}`));

print("\n2. legacy_dm edges by connectStatus");
edges
    .aggregate([{ $match: { dmPermissionSource: "legacy_dm" } }, { $group: { _id: "$connectStatus", n: { $sum: 1 } } }])
    .forEach((r) => print(`   ${r._id}: ${r.n}`));

print("\n3. non-archived DM conversations by participant count");
conversations
    .aggregate([
        { $match: { type: "dm", archived: { $ne: true } } },
        { $group: { _id: { $size: { $ifNull: ["$participants", []] } }, n: { $sum: 1 } } },
        { $sort: { _id: 1 } },
    ])
    .forEach((r) => print(`   ${r._id} participant(s): ${r.n}`));

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const pairsWithMessages = new Set();
const pairsEmptyOnly = new Set();
const pairStates = {};
let beforeCutoff = 0;

conversations.find({ type: "dm", archived: { $ne: true } }, { participants: 1 }).forEach((c) => {
    const p = Array.from(new Set((c.participants || []).filter((d) => typeof d === "string" && d.length > 0)));
    if (p.length !== 2) return;
    const key = pairKey(p[0], p[1]);
    const first = messages.find({ conversationId: String(c._id) }, { createdAt: 1 }).sort({ createdAt: 1 }).limit(1).toArray()[0];
    if (first) {
        pairsWithMessages.add(key);
        pairsEmptyOnly.delete(key);
        if (cutoff && first.createdAt && new Date(first.createdAt) < cutoff) beforeCutoff += 1;
    } else if (!pairsWithMessages.has(key)) {
        pairsEmptyOnly.add(key);
    }
    const a = edges.findOne({ fromDid: p[0], toDid: p[1] }, { connectStatus: 1 });
    const b = edges.findOne({ fromDid: p[1], toDid: p[0] }, { connectStatus: 1 });
    const state = `${first ? "has messages" : "empty"} | ${a?.connectStatus || "no edge"} / ${b?.connectStatus || "no edge"}`;
    pairStates[state] = (pairStates[state] || 0) + 1;
});

print("\n4. two-participant DM conversations by (messages) | (edge statuses)");
Object.keys(pairStates)
    .sort()
    .forEach((k) => print(`   ${k}: ${pairStates[k]}`));

print("\n5. legacy_dm edges by what backs them");
let backedByMessages = 0;
let backedByEmptyOnly = 0;
let noConversation = 0;
edges.find({ dmPermissionSource: "legacy_dm" }, { fromDid: 1, toDid: 1 }).forEach((e) => {
    const key = pairKey(e.fromDid, e.toDid);
    if (pairsWithMessages.has(key)) backedByMessages += 1;
    else if (pairsEmptyOnly.has(key)) backedByEmptyOnly += 1;
    else noConversation += 1;
});
print(`   conversation with at least one message (kept): ${backedByMessages}`);
print(`   only an empty conversation (would lose DM access): ${backedByEmptyOnly}`);
print(`   no non-archived DM conversation (would lose DM access): ${noConversation}`);

if (cutoff) {
    print(`\n6. two-participant DM conversations whose first message is before ${cutoff.toISOString()}: ${beforeCutoff}`);
}
