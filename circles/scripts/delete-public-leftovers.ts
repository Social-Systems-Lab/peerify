/**
 * Deletes leftover files from the PUBLIC bucket that have a name /storage and /uploads refuse
 * since storage step 6 (offer-photo* and verification-attachment*, see
 * src/lib/storage/refused-names.ts) and that nothing in the database mentions any more. They are
 * old public copies the moves didn't take (a photo removed from its offer before step 5, say):
 * nobody can fetch them from the site, and nothing uses them.
 *
 * "Mentioned" is broad on purpose (src/lib/storage/public-leftovers.ts): the file name, any case,
 * anywhere in any document of any collection. Anything mentioned is kept.
 *
 * Two modes. Each run prints counts only: no keys, URLs, ids or names.
 *   (default)   dry run: what would be deleted; no writes.
 *   --delete    deletes them. EXPECT_COUNT must equal the number the dry run printed as
 *               "would delete", or it refuses, so it deletes exactly what the dry run showed.
 * The files stay in the nightly backups until those age out.
 *
 * Run as peerify on the box, from the app checkout's circles/ dir, with the app env (MONGODB_URI,
 * MINIO_*). EXPECT_DB must match the database name:
 *   (set -a; . /srv/peerify/env/app.env; set +a; EXPECT_DB=peerify_staging bun scripts/delete-public-leftovers.ts)
 *   (... EXPECT_DB=peerify_staging EXPECT_COUNT=<n> bun scripts/delete-public-leftovers.ts --delete)
 */

import { BSON, MongoClient } from "mongodb";
import { Client as MinioClient } from "minio";
import { createLeftoverScan, fileNameOf, type PublicObject } from "../src/lib/storage/public-leftovers";

const refuse = (message: string): never => {
    console.error(`Refusing to run: ${message}`);
    process.exit(1);
};

const args = process.argv.slice(2);
for (const arg of args) if (arg !== "--delete") refuse(`unknown argument ${arg}.`);
const deleteMode = args.includes("--delete");

const MONGODB_URI = process.env.MONGODB_URI ?? refuse("MONGODB_URI is not set (source the app env).");
const EXPECT_DB = process.env.EXPECT_DB ?? refuse("set EXPECT_DB to the database name the URI points at.");
const accessKey = process.env.MINIO_ROOT_USERNAME ?? refuse("MINIO_ROOT_USERNAME is not set.");
const secretKey = process.env.MINIO_ROOT_PASSWORD ?? refuse("MINIO_ROOT_PASSWORD is not set.");
// No default: this deletes from the bucket, so it must be the one the app serves /storage from.
const publicBucket = process.env.MINIO_BUCKET ?? refuse("MINIO_BUCKET is not set.");
let expectCount = -1;
if (deleteMode) {
    const raw = process.env.EXPECT_COUNT ?? refuse("--delete needs EXPECT_COUNT, the dry run's 'would delete' number.");
    if (!/^[0-9]+$/.test(raw)) refuse("EXPECT_COUNT must be a whole number.");
    expectCount = parseInt(raw, 10);
}
const privateBucket = process.env.MINIO_PRIVATE_BUCKET;
if (privateBucket && privateBucket === publicBucket) refuse("MINIO_BUCKET and MINIO_PRIVATE_BUCKET are the same.");

const minio = new MinioClient({
    endPoint: process.env.MINIO_HOST || "127.0.0.1",
    port: parseInt(process.env.MINIO_PORT || "9000", 10),
    useSSL: false,
    accessKey,
    secretKey,
});

const isMissing = (err: unknown) => {
    const code = (err as { code?: string } | null)?.code;
    return code === "NoSuchKey" || code === "NotFound";
};

const listBucket = (bucket: string): Promise<PublicObject[]> =>
    new Promise((resolve, reject) => {
        const out: PublicObject[] = [];
        const stream = minio.listObjectsV2(bucket, "", true);
        stream.on("data", (item: { name?: string; size?: number }) => {
            if (item.name) out.push({ name: item.name, size: item.size ?? 0 });
        });
        stream.on("error", reject);
        stream.on("end", () => resolve(out));
    });

async function main() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    try {
        const db = client.db();
        if (db.databaseName !== EXPECT_DB) refuse(`connected to "${db.databaseName}", EXPECT_DB is "${EXPECT_DB}".`);
        if (!(await minio.bucketExists(publicBucket))) refuse("the configured public bucket does not exist.");
        console.log(`Database: ${db.databaseName}  mode: ${deleteMode ? "DELETE" : "DRY RUN"}`);

        const objects = await listBucket(publicBucket);
        const scan = createLeftoverScan(objects);
        if (scan.candidates.length > 0) {
            const collections = (await db.listCollections({ type: "collection" }, { nameOnly: true }).toArray())
                .map((c) => c.name)
                .filter((name) => !name.startsWith("system."));
            for (const name of collections) {
                for await (const doc of db.collection(name).find({})) scan.scan(BSON.EJSON.stringify(doc));
            }
        }
        const leftovers = scan.unreferenced();
        const offers = leftovers.filter((o) => fileNameOf(o.name).startsWith("offer-photo")).length;
        const bytes = leftovers.reduce((sum, o) => sum + o.size, 0);

        console.log(`objects in the public bucket:              ${objects.length}`);
        console.log(`  with a name /storage refuses:            ${scan.candidates.length}`);
        console.log(`  mentioned in the database (kept):        ${scan.mentionedCount()}`);
        console.log(
            `  unreferenced, would delete:              ${leftovers.length} (${offers} offer photo(s), ${leftovers.length - offers} verification attachment(s), ${bytes} bytes)`,
        );

        if (!deleteMode) {
            console.log("Dry run only. Nothing was changed.");
            return;
        }
        if (leftovers.length !== expectCount) {
            refuse(
                `EXPECT_COUNT is ${expectCount}, but ${leftovers.length} would be deleted now. Nothing was deleted; run the dry run again.`,
            );
        }
        let deleted = 0;
        let alreadyGone = 0;
        for (const o of leftovers) {
            try {
                await minio.statObject(publicBucket, o.name);
            } catch (err) {
                if (!isMissing(err)) throw err;
                alreadyGone += 1;
                continue;
            }
            await minio.removeObject(publicBucket, o.name);
            deleted += 1;
        }
        console.log(`deleted now:                               ${deleted}`);
        console.log(`already gone:                              ${alreadyGone}`);
    } finally {
        await client.close();
    }
}

main().catch((err) => {
    // Only the error's name and message: no URIs, keys or document contents.
    console.error(`Failed: ${(err as Error)?.name}: ${(err as Error)?.message}`);
    process.exit(1);
});
