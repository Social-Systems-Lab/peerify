// READ ONLY (counts only; there is no apply mode). Crew round 2 audit, 2026-11-18: do any stored shift
// sign-ups or task claims hold null where the code expects a field to be missing or set? The driver
// stores undefined as null (no ignoreUndefined), so older data could. Confirm, decline and leave now
// match "verifiedAt is null or missing", so a null verifiedAt no longer blocks them; this shows whether
// any such rows exist at all. It prints counts only: no ids, names or DIDs.
//
// Usage, from the repo root, with the read-only user:
//   (set -a; . /home/tim/.config/peerify/prod-ro.env; set +a; EXPECT_DB=circles mongosh --nodb --norc --quiet --file scripts/count-null-signup-fields.mongosh.js)
// EXPECT_DB must match the database the URI points at, so a wrong URI aborts.

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

const tasks = db.getCollection("tasks");
const isNull = { $type: "null" };
const checks = [
    ["shifts in total", { taskType: "shift" }],
    ["shifts whose participants is null", { taskType: "shift", participants: isNull }],
    ["shifts with no participants field", { taskType: "shift", participants: { $exists: false } }],
    ["shifts with a participant whose verifiedAt is null", { participants: { $elemMatch: { verifiedAt: isNull } } }],
    ["shifts with a participant whose verifiedBy is null", { participants: { $elemMatch: { verifiedBy: isNull } } }],
    ["shifts with a participant whose joinedAt is null or missing", { participants: { $elemMatch: { joinedAt: null } } }],
    ["shifts with a participant whose userDid is null or missing", { participants: { $elemMatch: { userDid: null } } }],
    ["tasks with claims", { "claims.0": { $exists: true } }],
    ["tasks with a claim whose status is null or missing", { claims: { $elemMatch: { status: null } } }],
    [
        "tasks with a reviewed claim (approved/declined/closed) whose reviewedAt is null or missing",
        { claims: { $elemMatch: { status: { $in: ["approved", "declined", "closed"] }, reviewedAt: null } } },
    ],
    ["tasks with a claim whose createdAt is null or missing", { claims: { $elemMatch: { createdAt: null } } }],
];
for (const [label, filter] of checks) {
    print(`${String(tasks.countDocuments(filter)).padStart(6)}  ${label}`);
}
