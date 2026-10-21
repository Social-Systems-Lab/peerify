/**
 * DRY RUN ONLY (there is no apply mode). Lists object-storage "directories" whose circle no longer
 * exists: top-level prefixes "<circleId>/" in the public bucket and "audio/<circleId>/" in the
 * private audio bucket. These are what a delete left behind before account erasure
 * (src/lib/data/account-erasure.ts) removed files. Prints prefixes, object counts and sizes only.
 *
 * It does not look for unreferenced files under circles that still exist (that would need every
 * URL in the database), and does not open any object.
 *
 *   ENV_FILE=<app env file> EXPECT_DB=<db name> bun scripts/find-orphan-storage-prefixes.ts
 *
 * ENV_FILE is the env file the running app uses (MONGODB_URI, MINIO_*). EXPECT_DB must equal the
 * database in its MONGODB_URI, so the wrong env file aborts. Uses the raw MongoDB and MinIO clients
 * only (no app modules), and only reads.
 */

import fs from "fs";
import { MongoClient } from "mongodb";
import { Client as MinioClient } from "minio";

const fail = (message: string): never => {
    console.error(`FAIL find-orphan-storage-prefixes: ${message}`);
    process.exit(2);
};

const { ENV_FILE, EXPECT_DB } = process.env;
if (!ENV_FILE || !EXPECT_DB) fail("set ENV_FILE and EXPECT_DB");
if (!fs.existsSync(ENV_FILE!)) fail(`ENV_FILE ${ENV_FILE} does not exist`);

// The env file wins over anything bun loaded from the working directory.
for (const line of fs.readFileSync(ENV_FILE!, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[m[1]] = value;
}
const uri = process.env.MONGODB_URI;
if (!uri) fail("MONGODB_URI is not set in ENV_FILE");
const dbName = new URL(uri!).pathname.replace(/^\//, "") || "circles";
if (dbName !== EXPECT_DB) fail(`ENV_FILE points at database "${dbName}", not EXPECT_DB "${EXPECT_DB}"`);
if (!process.env.MINIO_ROOT_USERNAME || !process.env.MINIO_ROOT_PASSWORD) fail("MINIO_ROOT_* are not set in ENV_FILE");

const publicBucket = process.env.MINIO_BUCKET || "circles";
const privateBucket = process.env.MINIO_PRIVATE_BUCKET || "peerify-media";
const minio = new MinioClient({
    endPoint: process.env.MINIO_HOST || "127.0.0.1",
    port: parseInt(process.env.MINIO_PORT || "9000"),
    useSSL: false,
    accessKey: process.env.MINIO_ROOT_USERNAME!,
    secretKey: process.env.MINIO_ROOT_PASSWORD!,
});

// Immediate sub-"directories" of `prefix` (non-recursive listing returns them as `prefix` entries).
const listPrefixes = async (bucket: string, prefix: string): Promise<string[]> => {
    const out: string[] = [];
    for await (const obj of minio.listObjectsV2(bucket, prefix, false)) {
        if ((obj as { prefix?: string }).prefix) out.push((obj as { prefix: string }).prefix);
    }
    return out;
};
const sizeOf = async (bucket: string, prefix: string) => {
    let count = 0;
    let bytes = 0;
    for await (const obj of minio.listObjectsV2(bucket, prefix, true)) {
        count++;
        bytes += obj.size ?? 0;
    }
    return { count, bytes };
};
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const ID = /^[0-9a-f]{24}$/;

const main = async () => {
    const client = new MongoClient(uri!);
    await client.connect();
    try {
        const circleIds = new Set(
            (await client.db(dbName).collection("circles").find({}, { projection: { _id: 1 } }).toArray()).map((c) =>
                String(c._id),
            ),
        );
        console.log(`find-orphan-storage-prefixes (DRY RUN, read only) db=${dbName} circles=${circleIds.size}`);

        const report = async (bucket: string, prefix: string, label: string) => {
            if (!(await minio.bucketExists(bucket))) {
                console.log(`\n${label}: bucket "${bucket}" does not exist`);
                return;
            }
            const prefixes = await listPrefixes(bucket, prefix);
            const orphans: string[] = [];
            const other: string[] = [];
            for (const p of prefixes) {
                const id = p.slice(prefix.length).replace(/\/$/, "");
                if (!ID.test(id)) other.push(p);
                else if (!circleIds.has(id)) orphans.push(p);
            }
            console.log(`\n${label} (bucket "${bucket}", under "${prefix || "/"}"): ${prefixes.length} prefixes, ${orphans.length} with no circle`);
            let totalCount = 0;
            let totalBytes = 0;
            for (const p of orphans) {
                const { count, bytes } = await sizeOf(bucket, p);
                totalCount += count;
                totalBytes += bytes;
                console.log(`  ${p}  ${count} objects, ${mb(bytes)}`);
            }
            if (orphans.length) console.log(`  total: ${totalCount} objects, ${mb(totalBytes)}`);
            if (other.length) console.log(`  not circle ids (left alone): ${other.join(", ")}`);
        };

        await report(publicBucket, "", "Public files");
        await report(privateBucket, "audio/", "Private audio");
        console.log("\nDry run only. Nothing was changed.");
    } finally {
        await client.close();
    }
};

main().catch((err) => {
    console.error(`FAIL find-orphan-storage-prefixes: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
