/**
 * Removes stale personal-data copies that were stored alongside comments and notifications.
 *
 * Comments (the default): until 3c33dba1, post and song comments were stored with `author`, the
 * commenter's whole circle document at the time (location, metadata, members, offers, ...). No
 * reader uses it (they look the author up fresh), so this removes the field: $unset author.
 * Nothing else in the comment changes.
 *
 * Notifications (--notifications, separately): stored before 2026-11-05, notification content can
 * hold whole user/circle documents. The app already reduces it on read (shapeNotificationContent);
 * this stores the reduced form, so the bell and account erasure see exactly what they see today.
 * ON HOLD until IMY says whether the stored data must be kept as evidence: it refuses to run, even
 * as a dry run, unless IMY_CLEARED=yes is set.
 *
 * Each run prints counts only: no ids, names or content.
 *   (default)                     dry run, comments: how many have a stored author copy.
 *   --apply                       removes them. EXPECT_COUNT must equal the dry run's number.
 *   --notifications               dry run, notifications: how many would be reduced.
 *   --notifications --apply       reduces them. EXPECT_NOTIFICATION_COUNT must equal the dry run's.
 *
 * Run as peerify on the box, from the app checkout's circles/ dir, with the app env (MONGODB_URI).
 * EXPECT_DB must match the database name:
 *   (set -a; . /srv/peerify/env/app.env; set +a; EXPECT_DB=peerify_staging bun scripts/cleanup-comment-authors.ts)
 *   (... EXPECT_DB=peerify_staging EXPECT_COUNT=<n> bun scripts/cleanup-comment-authors.ts --apply)
 */

import { BSON, MongoClient, type ObjectId } from "mongodb";
import { shapeNotificationContent } from "../src/lib/data/notification-shape";

const refuse = (message: string): never => {
    console.error(`Refusing to run: ${message}`);
    process.exit(1);
};

const args = process.argv.slice(2);
for (const arg of args) if (arg !== "--apply" && arg !== "--notifications") refuse(`unknown argument ${arg}.`);
const apply = args.includes("--apply");
const notifications = args.includes("--notifications");

if (notifications && process.env.IMY_CLEARED !== "yes") {
    refuse("the notification clean-up waits for IMY's answer. Set IMY_CLEARED=yes only once IMY has cleared it.");
}
const MONGODB_URI = process.env.MONGODB_URI ?? refuse("MONGODB_URI is not set (source the app env).");
const EXPECT_DB = process.env.EXPECT_DB ?? refuse("set EXPECT_DB to the database name the URI points at.");
const countVar = notifications ? "EXPECT_NOTIFICATION_COUNT" : "EXPECT_COUNT";
let expectCount = -1;
if (apply) {
    const raw = process.env[countVar] ?? refuse(`--apply needs ${countVar}, the dry run's number.`);
    if (!/^[0-9]+$/.test(raw)) refuse(`${countVar} must be a whole number.`);
    expectCount = parseInt(raw, 10);
}

const text = (value: unknown) => BSON.EJSON.stringify(value ?? null, { relaxed: false });

async function main() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    try {
        const db = client.db();
        if (db.databaseName !== EXPECT_DB) refuse(`connected to "${db.databaseName}", EXPECT_DB is "${EXPECT_DB}".`);
        const mode = `${notifications ? "NOTIFICATIONS" : "COMMENTS"} ${apply ? "APPLY" : "DRY RUN"}`;
        console.log(`Database: ${db.databaseName}  mode: ${mode}`);

        if (!notifications) {
            const comments = db.collection("comments");
            const total = await comments.countDocuments({});
            const ids = (await comments.find({ author: { $exists: true } }, { projection: { _id: 1 } }).toArray()).map(
                (d) => d._id as ObjectId,
            );
            const songs = await comments.countDocuments({ author: { $exists: true }, trackId: { $exists: true } });
            console.log(`comments:                                  ${total}`);
            console.log(
                `  with a stored author copy:               ${ids.length} (${ids.length - songs} post, ${songs} song)`,
            );
            if (!apply) {
                console.log("Dry run only. Nothing was changed.");
                return;
            }
            if (ids.length !== expectCount) {
                refuse(
                    `EXPECT_COUNT is ${expectCount}, but ${ids.length} have a stored author copy now. Nothing was changed.`,
                );
            }
            const res = ids.length
                ? await comments.updateMany(
                      { _id: { $in: ids }, author: { $exists: true } },
                      { $unset: { author: "" } },
                  )
                : { modifiedCount: 0 };
            const left = await comments.countDocuments({ author: { $exists: true } });
            console.log(`author copy removed now:                   ${res.modifiedCount}`);
            console.log(`  with a stored author copy, after:        ${left}`);
            return;
        }

        const coll = db.collection("notifications");
        const total = await coll.countDocuments({});
        // Each notification whose stored content differs from its reduced form.
        const todo: { _id: ObjectId; content: unknown; shaped: unknown }[] = [];
        for await (const doc of coll.find({}, { projection: { _id: 1, content: 1 } })) {
            if (doc.content === undefined) continue;
            const shaped = shapeNotificationContent(doc.content);
            if (text(shaped) !== text(doc.content))
                todo.push({ _id: doc._id as ObjectId, content: doc.content, shaped });
        }
        console.log(`notifications:                             ${total}`);
        console.log(`  with content to reduce:                  ${todo.length}`);
        if (!apply) {
            console.log("Dry run only. Nothing was changed.");
            return;
        }
        if (todo.length !== expectCount) {
            refuse(
                `EXPECT_NOTIFICATION_COUNT is ${expectCount}, but ${todo.length} would be reduced now. Nothing was changed.`,
            );
        }
        let reduced = 0;
        let changedMeanwhile = 0;
        for (const n of todo) {
            // Only if the content is still exactly what this run read.
            const res = await coll.updateOne({ _id: n._id, content: n.content }, { $set: { content: n.shaped } });
            if (res.modifiedCount === 1) reduced += 1;
            else changedMeanwhile += 1;
        }
        console.log(`reduced now:                               ${reduced}`);
        console.log(`changed meanwhile (left as they are):      ${changedMeanwhile}`);
    } finally {
        await client.close();
    }
}

main().catch((err) => {
    // Only the error's name and message: no URIs or document contents.
    console.error(`Failed: ${(err as Error)?.name}: ${(err as Error)?.message}`);
    process.exit(1);
});
