// Read-only. How many stored file references point at the public bucket (/storage/... or
// /uploads/...) for content that isn't meant to be public: offer photos (logged-in only, Tim
// 2026-10-28), chat attachments, verification attachments, post images outside a circle's default
// feed. Those routes serve any object to anyone who has its name (see SESSION_LOG 2026-10-28,
// /storage follow-up). Aggregates with $match/$project/$group/$lookup only. Prints counts only: no
// URLs, ids, dids, names or file names. No writes.
//
// Usage, from the repo root, the same way as backfill-offer-pin-offsets.mongosh.js (the URI is read
// from MONGODB_URI, never argv; EXPECT_DB must match the database it points at):
//   EXPECT_DB=peerify_staging mongosh --nodb --norc --quiet --file scripts/st01-storage-private-refs.mongosh.js
//   EXPECT_DB=circles         mongosh --nodb --norc --quiet --file scripts/st01-storage-private-refs.mongosh.js

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
const d = db;
print(`== ${expectedDb}  (${new Date().toISOString()})`);

const isStored = (expr) => ({
    $regexMatch: { input: { $ifNull: [expr, ""] }, regex: "^(/storage/|/uploads/)" },
});
// Count of array elements whose `urlField` is a stored file.
const countStored = (arrayExpr, urlField) => ({
    $size: {
        $filter: {
            input: { $ifNull: [arrayExpr, []] },
            as: "x",
            cond: isStored(`$$x.${urlField}`),
        },
    },
});
const total = (coll, pipeline) => {
    const r = d.getCollection(coll).aggregate([...pipeline, { $group: { _id: null, docs: { $sum: { $cond: [{ $gt: ["$n", 0] }, 1, 0] } }, files: { $sum: "$n" } } }]).toArray()[0];
    return r ? `${r.files} files in ${r.docs} docs` : "0 files";
};

// 1. Offer photos (shown on the public profile today; to become logged-in only).
print(
    `offer photos (circles.tourTeamOfferings[].photos[]):     ${total("circles", [
        { $match: { "tourTeamOfferings.photos.0": { $exists: true } } },
        {
            $project: {
                n: {
                    $sum: {
                        $map: { input: "$tourTeamOfferings", as: "o", in: countStored("$$o.photos", "url") },
                    },
                },
            },
        },
    ])}`,
);

// 2. Chat attachments (live chat: chatMessageDocs).
print(
    `chat attachments (chatMessageDocs.attachments[]):        ${total("chatMessageDocs", [
        { $match: { "attachments.0": { $exists: true } } },
        { $project: { n: countStored("$attachments", "url") } },
    ])}`,
);

// 3. Verification attachments (verificationMessages.attachments[]).
print(
    `verification attachments (verificationMessages):         ${total("verificationMessages", [
        { $match: { "attachments.0": { $exists: true } } },
        { $project: { n: countStored("$attachments", "url") } },
    ])}`,
);

// 4. Post images, split by whether the post's feed is the circle's public "default" feed or
//    another feed (members/Crew). Only the second group is private content.
const postsByFeed = d
    .getCollection("posts")
    .aggregate([
        { $match: { "media.0": { $exists: true } } },
        { $project: { feedId: 1, n: countStored("$media", "fileInfo.url") } },
        { $match: { n: { $gt: 0 } } },
        { $addFields: { feedObjectId: { $convert: { input: "$feedId", to: "objectId", onError: null, onNull: null } } } },
        { $lookup: { from: "feeds", localField: "feedObjectId", foreignField: "_id", as: "feed" } },
        { $project: { n: 1, handle: { $ifNull: [{ $first: "$feed.handle" }, "(no feed)"] } } },
        { $group: { _id: { $cond: [{ $eq: ["$handle", "default"] }, "default feed", "other feeds"] }, posts: { $sum: 1 }, files: { $sum: "$n" } } },
        { $sort: { _id: 1 } },
    ])
    .toArray();
for (const r of postsByFeed) {
    print(`post images, ${r._id.padEnd(13)}:                        ${r.files} files in ${r.posts} posts`);
}
if (postsByFeed.length === 0) print("post images:                                             0 files");

print("\nDone. Read-only: nothing was changed.");
