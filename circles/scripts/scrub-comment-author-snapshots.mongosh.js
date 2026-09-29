// Removes private fields from the author snapshot stored on each comment document
// (comments.author). Comments created before ffda445a (2026-09-23, email dropped from
// SAFE_CIRCLE_PROJECTION) embed the commenter's email and officialEmail there. No code path
// returns this snapshot to clients any more, but the data should not sit in the collection.
//
// Usage (dry run is the default and only prints counts):
//   EXPECT_DB=circles mongosh "$MONGODB_URI" --quiet --file scripts/scrub-comment-author-snapshots.mongosh.js
// Apply:
//   EXPECT_DB=circles APPLY=1 mongosh "$MONGODB_URI" --quiet --file scripts/scrub-comment-author-snapshots.mongosh.js
//
// EXPECT_DB must match the database the URI points at, so a wrong URI aborts instead of
// touching the wrong database. Back up the comments collection before running with APPLY=1.

const FIELDS = [
    "email",
    "officialEmail",
    "emailVerificationToken",
    "emailVerificationTokenExpiry",
    "loginLinkToken",
    "loginLinkTokenExpiry",
    "passwordResetToken",
    "passwordResetTokenExpiry",
    "matrixAccessToken",
    "matrixUsername",
    "matrixPassword",
];

const expectedDb = process.env.EXPECT_DB;
const apply = process.env.APPLY === "1";

if (!expectedDb) {
    print("Refusing to run: set EXPECT_DB to the database name the URI points at.");
    quit(1);
}
if (db.getName() !== expectedDb) {
    print(`Refusing to run: connected to "${db.getName()}", EXPECT_DB is "${expectedDb}".`);
    quit(1);
}

const comments = db.getCollection("comments");
const anyField = { $or: FIELDS.map((f) => ({ [`author.${f}`]: { $exists: true } })) };

print(`Database: ${db.getName()}  mode: ${apply ? "APPLY" : "DRY RUN"}`);
print(`comments total:                     ${comments.countDocuments({})}`);
print(`comments with an author snapshot:   ${comments.countDocuments({ author: { $type: "object" } })}`);
print(`comments with any field to remove:  ${comments.countDocuments(anyField)}`);
for (const f of FIELDS) {
    const n = comments.countDocuments({ [`author.${f}`]: { $exists: true } });
    if (n > 0) print(`  author.${f}: ${n}`);
}

if (!apply) {
    print("Dry run only. Nothing was changed. Re-run with APPLY=1 to remove these fields.");
    quit(0);
}

const unset = Object.fromEntries(FIELDS.map((f) => [`author.${f}`, ""]));
const res = comments.updateMany(anyField, { $unset: unset });
print(`matched: ${res.matchedCount}  modified: ${res.modifiedCount}`);
print(`comments with any field remaining: ${comments.countDocuments(anyField)} (expected 0)`);
