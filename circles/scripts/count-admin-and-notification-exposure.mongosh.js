// Read-only counts for queue item 3 (admin invitations & profile admins):
//   1. user circles (circleType "user")
//   2. user circles with non-owner admins/moderators, and those member docs
//   3. adminInvitations on user circles, by status
//   4. all adminInvitations, by status
//   5. notifications whose embedded objects in `content` (content.user, content.circle, ... and
//      one level below those, e.g. content.task.author) carry private keys, by type and key
//   6. all notifications, by type
//
// Uses only countDocuments, find with projections, and aggregate. It never writes, and it prints
// counts, notification types and content field paths only: no names, handles, emails, DIDs
// or ids.
//
// Usage (run from the repo root; each .env.local holds a MONGODB_URI that names its database):
//   Staging:
//     (set -a; . /home/tim/apps/peerify-staging/circles/.env.local; set +a; EXPECT_DB=peerify_staging mongosh "$MONGODB_URI" --quiet --file scripts/count-admin-and-notification-exposure.mongosh.js)
//   Production:
//     (set -a; . /home/tim/apps/peerify-app/circles/.env.local; set +a; EXPECT_DB=circles mongosh "$MONGODB_URI" --quiet --file scripts/count-admin-and-notification-exposure.mongosh.js)
//
// EXPECT_DB must match the database the URI points at, so a wrong URI aborts instead of
// querying the wrong database.

const PRIVATE_KEYS = [
    "email",
    "officialEmail",
    "location",
    "memberships",
    "chatRoomMemberships",
    "bookmarkedCircles",
    "pinnedCircles",
    "loginLinkToken",
    "emailVerificationToken",
];
const ELEVATED_GROUPS = ["admins", "moderators"];

const expectedDb = process.env.EXPECT_DB;
if (!expectedDb) {
    print("Refusing to run: set EXPECT_DB to the database name the URI points at.");
    quit(1);
}
if (db.getName() !== expectedDb) {
    print(`Refusing to run: connected to "${db.getName()}", EXPECT_DB is "${expectedDb}".`);
    quit(1);
}

const circles = db.getCollection("circles");
const members = db.getCollection("members");
const adminInvitations = db.getCollection("adminInvitations");
const notifications = db.getCollection("notifications");

const byKey = (rows) => Object.fromEntries(rows.map((row) => [String(row._id), row.count]));

print(`Database: ${db.getName()}`);

// 1. User circles
const userCircleCount = circles.countDocuments({ circleType: "user" });
print("");
print(`1. User circles: ${userCircleCount}`);

// 2. Non-owner admins/moderators on user circles (members.circleId is the circle's _id as a string)
const [elevated] = circles
    .aggregate(
        [
            { $match: { circleType: "user" } },
            { $project: { _id: 0, circleIdStr: { $toString: "$_id" }, ownerDid: "$did" } },
            {
                $lookup: {
                    from: "members",
                    let: { cid: "$circleIdStr", owner: "$ownerDid" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $and: [{ $eq: ["$circleId", "$$cid"] }, { $ne: ["$userDid", "$$owner"] }] },
                                userGroups: { $in: ELEVATED_GROUPS },
                            },
                        },
                        { $project: { _id: 0, isAdmin: { $in: ["admins", { $ifNull: ["$userGroups", []] }] } } },
                    ],
                    as: "elevated",
                },
            },
            {
                $group: {
                    _id: null,
                    circlesWithElevated: { $sum: { $cond: [{ $gt: [{ $size: "$elevated" }, 0] }, 1, 0] } },
                    elevatedMemberDocs: { $sum: { $size: "$elevated" } },
                    adminMemberDocs: {
                        $sum: { $size: { $filter: { input: "$elevated", cond: "$$this.isAdmin" } } },
                    },
                },
            },
        ],
        { allowDiskUse: true },
    )
    .toArray();
print("");
print("2. User circles with non-owner admins/moderators");
print(`   circles with at least one:            ${elevated?.circlesWithElevated ?? 0}`);
print(`   non-owner admin/moderator member docs: ${elevated?.elevatedMemberDocs ?? 0}`);
print(`     of which include "admins":           ${elevated?.adminMemberDocs ?? 0}`);
print(`     moderators only:                     ${(elevated?.elevatedMemberDocs ?? 0) - (elevated?.adminMemberDocs ?? 0)}`);

// 3. adminInvitations on user circles, by status (circleId is a string _id; bad ids become null)
const invitationsByCircleType = adminInvitations
    .aggregate(
        [
            { $project: { _id: 0, status: 1, cid: { $convert: { input: "$circleId", to: "objectId", onError: null, onNull: null } } } },
            { $lookup: { from: "circles", localField: "cid", foreignField: "_id", pipeline: [{ $project: { _id: 0, circleType: 1 } }], as: "circle" } },
            {
                $project: {
                    status: 1,
                    target: {
                        $cond: [
                            { $eq: [{ $size: "$circle" }, 0] },
                            "missing circle",
                            { $cond: [{ $eq: [{ $arrayElemAt: ["$circle.circleType", 0] }, "user"] }, "user", "non-user"] },
                        ],
                    },
                },
            },
            { $group: { _id: { target: "$target", status: "$status" }, count: { $sum: 1 } } },
            { $sort: { "_id.target": 1, "_id.status": 1 } },
        ],
        { allowDiskUse: true },
    )
    .toArray();
const userInvitations = invitationsByCircleType.filter((row) => row._id.target === "user");
print("");
print("3. adminInvitations on user circles, by status");
if (userInvitations.length === 0) print("   (none)");
for (const row of userInvitations) print(`   ${row._id.status}: ${row.count}`);
const otherTargets = invitationsByCircleType.filter((row) => row._id.target !== "user");
if (otherTargets.length) {
    print("   (context) other targets:");
    for (const row of otherTargets) print(`     ${row._id.target} / ${row._id.status}: ${row.count}`);
}

// 4. All adminInvitations, by status
const allInvitations = byKey(
    adminInvitations.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
);
print("");
print(`4. All adminInvitations: ${adminInvitations.countDocuments({})}`);
if (Object.keys(allInvitations).length === 0) print("   (none)");
for (const [status, count] of Object.entries(allInvitations)) print(`   ${status}: ${count}`);

// 5. Private keys on objects embedded in notification content.
// Looks at every top-level field of `content` that is an object (or an array of objects), and at
// object fields one level below those. A key counts when present; "non-null" counts only
// values that are not null.
const exposurePairsPipeline = [
    { $match: { content: { $type: "object" } } },
    { $project: { type: 1, entry: { $objectToArray: "$content" } } },
    { $unwind: "$entry" },
    {
        $project: {
            type: 1,
            field: "$entry.k",
            objs: {
                $switch: {
                    branches: [
                        { case: { $eq: [{ $type: "$entry.v" }, "object"] }, then: ["$entry.v"] },
                        {
                            case: { $eq: [{ $type: "$entry.v" }, "array"] },
                            then: { $filter: { input: "$entry.v", cond: { $eq: [{ $type: "$$this" }, "object"] } } },
                        },
                    ],
                    default: [],
                },
            },
        },
    },
    { $unwind: "$objs" },
    { $project: { type: 1, field: 1, entries: { $objectToArray: "$objs" } } },
    {
        $project: {
            type: 1,
            pairs: {
                $concatArrays: [
                    {
                        $map: {
                            input: "$entries",
                            as: "x",
                            in: { path: "$field", k: "$$x.k", nonNull: { $ne: [{ $type: "$$x.v" }, "null"] } },
                        },
                    },
                    {
                        $reduce: {
                            input: { $filter: { input: "$entries", as: "x", cond: { $eq: [{ $type: "$$x.v" }, "object"] } } },
                            initialValue: [],
                            in: {
                                $concatArrays: [
                                    "$$value",
                                    {
                                        $map: {
                                            input: { $objectToArray: "$$this.v" },
                                            as: "y",
                                            in: {
                                                path: { $concat: ["$field", ".", "$$this.k"] },
                                                k: "$$y.k",
                                                nonNull: { $ne: [{ $type: "$$y.v" }, "null"] },
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                ],
            },
        },
    },
    { $unwind: "$pairs" },
    { $match: { "pairs.k": { $in: PRIVATE_KEYS } } },
];

// Per type and key: distinct notifications (a doc counts once per key, whichever path holds it)
const perTypeKey = notifications
    .aggregate(
        [
            ...exposurePairsPipeline,
            { $group: { _id: { doc: "$_id", type: "$type", k: "$pairs.k" }, nonNull: { $max: "$pairs.nonNull" } } },
            {
                $group: {
                    _id: { type: "$_id.type", k: "$_id.k" },
                    docs: { $sum: 1 },
                    nonNull: { $sum: { $cond: ["$nonNull", 1, 0] } },
                },
            },
            { $sort: { "_id.type": 1, "_id.k": 1 } },
        ],
        { allowDiskUse: true },
    )
    .toArray();

// Per type: distinct notifications carrying at least one private key
const perTypeAny = byKey(
    notifications
        .aggregate(
            [
                ...exposurePairsPipeline,
                { $group: { _id: { doc: "$_id", type: "$type" } } },
                { $group: { _id: "$_id.type", count: { $sum: 1 } } },
            ],
            { allowDiskUse: true },
        )
        .toArray(),
);

// Per type and content path: which embedded objects carry the keys
const perTypePath = notifications
    .aggregate(
        [
            ...exposurePairsPipeline,
            { $group: { _id: { doc: "$_id", type: "$type", path: "$pairs.path" } } },
            { $group: { _id: { type: "$_id.type", path: "$_id.path" }, count: { $sum: 1 } } },
            { $sort: { "_id.type": 1, "_id.path": 1 } },
        ],
        { allowDiskUse: true },
    )
    .toArray();

print("");
print("5. Notifications with private keys in embedded content objects");
print(`   keys checked: ${PRIVATE_KEYS.join(", ")}`);
const exposedTypes = Object.keys(perTypeAny).sort();
if (exposedTypes.length === 0) print("   (none)");
for (const type of exposedTypes) {
    print(`   ${type}: ${perTypeAny[type]} notifications with at least one key`);
    for (const row of perTypeKey.filter((r) => r._id.type === type)) {
        print(`     ${row._id.k.padEnd(24)} present ${String(row.docs).padStart(7)}   non-null ${String(row.nonNull).padStart(7)}`);
    }
    const paths = perTypePath.filter((r) => r._id.type === type);
    print(`     found under: ${paths.map((r) => `content.${r._id.path} (${r.count})`).join(", ")}`);
}

// 6. All notifications, by type
const allNotifications = notifications
    .aggregate([{ $group: { _id: "$type", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }], { allowDiskUse: true })
    .toArray();
print("");
print(`6. All notifications: ${notifications.countDocuments({})}`);
for (const row of allNotifications) print(`   ${String(row._id).padEnd(44)} ${row.count}`);
