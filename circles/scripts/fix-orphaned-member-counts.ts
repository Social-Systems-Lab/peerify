/**
 * Cleanup: orphaned Members rows and stale circle.members counters
 *
 * A circle's "N Followers" header reads the stored `members` counter, while
 * the followers table reads a live aggregation that drops any Members row
 * whose userDid has no matching circles document. Deleting a user account
 * previously left that user's Members rows dangling in every other circle
 * they had joined/followed, without decrementing those circles' counters
 * (see the deleteCircle() fix in src/lib/data/circle.ts). This script finds
 * and removes those dangling rows and corrects the counters to match reality.
 *
 * Dry-run (default): bun scripts/fix-orphaned-member-counts.ts
 * Apply:             bun scripts/fix-orphaned-member-counts.ts --apply
 */

import { MongoClient, ObjectId } from "mongodb";

const MONGODB_URI =
    process.env.MONGODB_URI ||
    `mongodb://${process.env.MONGO_ROOT_USERNAME || "admin"}:${process.env.MONGO_ROOT_PASSWORD || "password"}@${process.env.MONGO_HOST || "127.0.0.1"}:${process.env.MONGO_PORT || "27017"}`;
const dbName = new URL(MONGODB_URI).pathname.replace(/^\//, "") || "circles";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const mode = apply ? "apply" : "dry-run";

async function main() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(dbName);
    const circles = db.collection("circles");
    const members = db.collection("members");

    const validDids = new Set((await circles.distinct("did")).filter(Boolean));

    const allMemberships = await members.find({}).toArray();
    const orphaned = allMemberships.filter((m) => !validDids.has(m.userDid));

    console.log(`Total Members rows:    ${allMemberships.length}`);
    console.log(`Orphaned Members rows: ${orphaned.length}\n`);

    const orphanedByCircle = new Map<string, { count: number; ids: ObjectId[] }>();
    for (const m of orphaned) {
        const entry = orphanedByCircle.get(m.circleId) || { count: 0, ids: [] };
        entry.count += 1;
        entry.ids.push(m._id);
        orphanedByCircle.set(m.circleId, entry);
    }

    const plans: Array<{ circleId: string; label: string; storedCount: number; orphanedCount: number; correctedCount: number }> = [];

    for (const [circleId, { count }] of orphanedByCircle) {
        const circle = await circles.findOne({ _id: new ObjectId(circleId) });
        const storedCount = circle?.members ?? 0;
        const correctedCount = Math.max(storedCount - count, 0);
        plans.push({
            circleId,
            label: circle ? circle.handle || circle.name || circleId : `(circle not found: ${circleId})`,
            storedCount,
            orphanedCount: count,
            correctedCount,
        });
    }

    console.log(`Affected circles (${mode}):`);
    for (const p of plans) {
        console.log(`  ${p.label} (${p.circleId}): members ${p.storedCount} -> ${p.correctedCount} (removing ${p.orphanedCount} orphaned rows)`);
    }
    console.log();

    if (apply) {
        await members.deleteMany({ _id: { $in: orphaned.map((m) => m._id) } });
        for (const p of plans) {
            const decrementBy = p.storedCount - p.correctedCount;
            if (decrementBy > 0) {
                await circles.updateOne({ _id: new ObjectId(p.circleId) }, { $inc: { members: -decrementBy } });
            }
        }
    }

    console.log(`Summary (${mode}):`);
    console.log(`  orphaned rows removed:    ${apply ? orphaned.length : 0} (of ${orphaned.length} found)`);
    console.log(`  circles corrected:        ${apply ? plans.length : 0} (of ${plans.length} affected)`);

    await client.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
