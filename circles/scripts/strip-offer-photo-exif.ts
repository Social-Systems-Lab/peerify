/**
 * One-time reprocessing: strip EXIF/ICC/XMP metadata from already-saved offer photos.
 *
 * Context: offer photos (Circle.tourTeamOfferings[].photos) were saved with no metadata
 * stripping until the fix in src/app/circles/[handle]/settings/presence/actions.ts
 * (resolveOfferingPhotos → stripPhotoMetadata) landed. That fix only covers photos saved from
 * here on — this script catches up every photo saved before it, since offer photos are about to
 * become visible to any authenticated member (not just the circle's own admin), and an
 * accommodation photo's embedded GPS EXIF would leak the exact address the map-pin coarse-jitter
 * grid (getOfferPinLocation) is deliberately designed to hide.
 *
 * Overwrites each photo object in place at its existing MinIO key — the Mongo document's
 * `url`/`fileName` never change, so no DB write is needed, only a re-upload of the same object
 * with stripped bytes. `.rotate()` bakes in the EXIF orientation before the strip removes it
 * (same reasoning as stripPhotoMetadata in presence/actions.ts) so photos taken on their side
 * don't end up rendering sideways.
 *
 * Dry-run (default, no writes): bun scripts/strip-offer-photo-exif.ts
 * Apply:                        bun scripts/strip-offer-photo-exif.ts --apply
 */

import { MongoClient } from "mongodb";
import { Client as MinioClient } from "minio";
import sharp from "sharp";

const MONGODB_URI =
    process.env.MONGODB_URI ||
    `mongodb://${process.env.MONGO_ROOT_USERNAME || "admin"}:${process.env.MONGO_ROOT_PASSWORD || "password"}@${process.env.MONGO_HOST || "127.0.0.1"}:${process.env.MONGO_PORT || "27017"}`;

const minioClient = new MinioClient({
    endPoint: process.env.MINIO_HOST || "127.0.0.1",
    port: parseInt(process.env.MINIO_PORT || "9000"),
    useSSL: false,
    accessKey: process.env.MINIO_ROOT_USERNAME || "minioadmin",
    secretKey: process.env.MINIO_ROOT_PASSWORD || "minioadmin",
});
const bucketName = process.env.MINIO_BUCKET || "circles";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const mode = apply ? "apply" : "dry-run";

function objectKeyFromUrl(url: string): string | undefined {
    if (!url.startsWith("/storage/")) return undefined; // /uploads/... (LOCAL_FS_STORAGE) has no MinIO object to reprocess
    return url.slice("/storage/".length);
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

async function main() {
    console.log(`Mode: ${mode}. Bucket: ${bucketName}.`);

    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const dbName = new URL(MONGODB_URI).pathname.replace(/^\//, "") || "circles";
    const db = client.db(dbName);
    console.log(`DB: ${db.databaseName}`);

    const circles = await db
        .collection("circles")
        .find(
            { "tourTeamOfferings.photos.0": { $exists: true } },
            { projection: { _id: 1, handle: 1, tourTeamOfferings: 1 } },
        )
        .toArray();

    console.log(`Circles with at least one offer photo: ${circles.length}`);

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const circle of circles) {
        for (const offering of circle.tourTeamOfferings || []) {
            for (const photo of offering.photos || []) {
                const url: string | undefined = photo?.url;
                if (!url) {
                    skipped++;
                    continue;
                }
                const objectKey = objectKeyFromUrl(url);
                if (!objectKey) {
                    console.log(`  SKIP (non-storage url): ${circle.handle} ${offering.id} ${url}`);
                    skipped++;
                    continue;
                }

                try {
                    const stat = await minioClient.statObject(bucketName, objectKey);
                    const contentType = stat.metaData?.["content-type"] || "application/octet-stream";
                    const original = await streamToBuffer(await minioClient.getObject(bucketName, objectKey));
                    const stripped = await sharp(original).rotate().toBuffer();

                    const changedSize = stripped.length !== original.length;
                    console.log(
                        `  ${apply ? "REWRITE" : "WOULD REWRITE"}: ${circle.handle} ${offering.id} ${objectKey} ` +
                            `(${original.length}B -> ${stripped.length}B${changedSize ? "" : ", size unchanged — may already have had no metadata"})`,
                    );

                    if (apply) {
                        await minioClient.putObject(bucketName, objectKey, stripped, stripped.length, {
                            "Content-Type": contentType,
                        });
                    }
                    processed++;
                } catch (error) {
                    console.error(`  FAILED: ${circle.handle} ${offering.id} ${objectKey}:`, error);
                    failed++;
                }
            }
        }
    }

    console.log(`\nDone. Processed: ${processed}, skipped: ${skipped}, failed: ${failed}.`);
    if (!apply) {
        console.log("Dry run only — re-run with --apply to actually rewrite objects in MinIO.");
    }

    await client.close();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
