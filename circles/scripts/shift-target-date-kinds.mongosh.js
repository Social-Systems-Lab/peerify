// READ ONLY (no apply mode). Shift date time-zone bug, 2026-11-18: how were shift and task targetDates
// written? Today's form sends the browser's local midnight (calendar pick) or the event's start instant
// (shift created from an event). The stored UTC time of day tells them apart:
//   22:00 = midnight in Cape Town (SAST, UTC+2); 23:00 = midnight in Sweden in winter (CET); 22:00 is
//   also midnight CEST in summer; 00:00 = UTC midnight; anything else = probably an event's start time.
// Prints counts per UTC time of day, and, for the shift titles in TITLES (comma separated), the stored
// fields and the linked event's startAt. Titles of shifts only: no names, DIDs or participants.
//
// Usage, from the repo root, with the read-only user:
//   (set -a; . /home/tim/.config/peerify/prod-ro.env; set +a; EXPECT_DB=circles TITLES="Door crew,Kitchen" mongosh --nodb --norc --quiet --file scripts/shift-target-date-kinds.mongosh.js)
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
const byTimeOfDay = (match) =>
    tasks
        .aggregate([
            { $match: { ...match, targetDate: { $type: "date" } } },
            { $group: { _id: { $dateToString: { format: "%H:%M", date: "$targetDate" } }, n: { $sum: 1 } } },
            { $sort: { n: -1 } },
        ])
        .toArray();

for (const [label, match] of [
    ["shifts", { taskType: "shift" }],
    ["tasks (not shifts) with a date", { taskType: { $ne: "shift" } }],
]) {
    print(`${label}, by stored UTC time of day:`);
    for (const row of byTimeOfDay(match)) print(`  ${row._id}  ${row.n}`);
}

const titles = (process.env.TITLES || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
if (titles.length) {
    const events = db.getCollection("events");
    print("Named shifts:");
    tasks
        .find(
            { taskType: "shift", title: { $in: titles } },
            { title: 1, targetDate: 1, shiftStartTime: 1, shiftDurationMinutes: 1, eventId: 1, createdAt: 1, updatedAt: 1 },
        )
        .forEach((t) => {
            let eventStart = "";
            if (t.eventId) {
                try {
                    const e = events.findOne({ _id: ObjectId(String(t.eventId)) }, { startAt: 1 });
                    eventStart = e && e.startAt ? e.startAt.toISOString() : "(event not found)";
                } catch (err) {
                    eventStart = "(bad eventId)";
                }
            }
            print(
                `  ${t.title}: targetDate=${t.targetDate && t.targetDate.toISOString()} start=${t.shiftStartTime} ` +
                    `duration=${t.shiftDurationMinutes} eventStartAt=${eventStart}`,
            );
        });
}
