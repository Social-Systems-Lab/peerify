// Gives every circle that has offers its offer pin offset (circles.offerPinOffset), the stored
// 200–400 m move getOfferPinLocation (src/lib/utils.ts) applies to its offer pins. New offers get
// one from ensureOfferPinOffset (src/lib/data/circle.ts) when they are saved; this script covers
// circles whose offers were saved before that. Until a circle has one, its pins stay on the
// 0.05° grid, so running this late is safe, just less precise.
//
// Never replaces an offset: each update only matches a circle that has none. A second, different
// offset for the same address would let anyone who saw both pins narrow the address down to where
// the two rings cross. Re-running is harmless.
//
// Same generator as generateOfferPinOffset in src/lib/data/circle.ts: crypto randomness, distance
// uniform by area over 200–400 m, any bearing. Prints counts only: no ids, names or coordinates.
//
// Usage, from the repo root (dry run is the default and only prints counts):
//   (set -a; . <app checkout>/circles/.env.local; set +a; EXPECT_DB=peerify_staging mongosh --nodb --norc --quiet --file scripts/backfill-offer-pin-offsets.mongosh.js)
// Apply:
//   (set -a; . <app checkout>/circles/.env.local; set +a; EXPECT_DB=peerify_staging APPLY=1 mongosh --nodb --norc --quiet --file scripts/backfill-offer-pin-offsets.mongosh.js)
// Staging first (EXPECT_DB=peerify_staging); prod (EXPECT_DB=circles) only after the code is live
// there, since an older release ignores the field.
//
// EXPECT_DB must match the database the URI points at, so a wrong URI aborts instead of
// touching the wrong database. The script only adds a field, so there is nothing to back up; to
// undo, $unset offerPinOffset (the pins go back to the grid).

const crypto = require("crypto");

const MIN_METERS = 200;
const MAX_METERS = 400;

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
const apply = process.env.APPLY === "1";

if (!expectedDb) {
    print("Refusing to run: set EXPECT_DB to the database name the URI points at.");
    quit(1);
}
if (db.getName() !== expectedDb) {
    print(`Refusing to run: connected to "${db.getName()}", EXPECT_DB is "${expectedDb}".`);
    quit(1);
}

const circles = db.getCollection("circles");
const hasOffers = { tourTeamOfferings: { $exists: true, $not: { $size: 0 } } };
const missing = { $and: [hasOffers, { offerPinOffset: { $exists: false } }] };
const invalid = {
    offerPinOffset: { $exists: true },
    $nor: [
        {
            "offerPinOffset.bearingDeg": { $type: "number" },
            "offerPinOffset.distanceM": { $gte: MIN_METERS, $lte: MAX_METERS },
        },
    ],
};

const generate = () => {
    const unit = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
    return {
        bearingDeg: Math.round(unit() * 360 * 100) / 100,
        distanceM: Math.round(Math.sqrt(MIN_METERS ** 2 + unit() * (MAX_METERS ** 2 - MIN_METERS ** 2))),
    };
};

print(`Database: ${db.getName()}  mode: ${apply ? "APPLY" : "DRY RUN"}`);
print(`circles with offers:                     ${circles.countDocuments(hasOffers)}`);
print(`  of which offersVisible true:           ${circles.countDocuments({ ...hasOffers, offersVisible: true })}`);
print(`circles with an offset already:          ${circles.countDocuments({ offerPinOffset: { $exists: true } })}`);
print(`circles with an invalid offset:          ${circles.countDocuments(invalid)} (expected 0; the app shows these on the grid)`);
print(`circles with offers and no offset:       ${circles.countDocuments(missing)}`);

if (!apply) {
    print("Dry run only. Nothing was changed. Re-run with APPLY=1 to add the missing offsets.");
    quit(0);
}

let modified = 0;
circles.find(missing, { projection: { _id: 1 } }).forEach((doc) => {
    const res = circles.updateOne({ _id: doc._id, offerPinOffset: { $exists: false } }, { $set: { offerPinOffset: generate() } });
    modified += res.modifiedCount;
});
print(`modified: ${modified}`);
print(`circles with offers and no offset now:   ${circles.countDocuments(missing)} (expected 0)`);
print(`circles with an invalid offset now:      ${circles.countDocuments(invalid)} (expected 0)`);
