/**
 * Moves offer photos saved before 617d5f90 from the public bucket (served to anyone with the URL
 * by /storage) to the private bucket, behind /api/offer-photo (signed-in viewers only; see
 * src/lib/media/offer-photo.ts). New photos already go there.
 *
 * Three modes. Each run prints counts only: no keys, URLs, ids, names or file names.
 *   (default)      dry run: what the copy and delete phases would do; no writes.
 *   --copy         for each circle with /storage offer photos: read each public object, write it
 *                  to the private bucket as offer-photos/<circle id>/<random>.<ext>, check the
 *                  size, then rewrite the circle's offerings to the new addresses. One row per
 *                  moved photo goes into offerPhotoMoves (circle id, old and new key) for the
 *                  delete phase. The public object is NOT touched, so the old URL still works.
 *   --delete-old   for each offerPhotoMoves row: if the private copy exists and the circle no
 *                  longer uses the old URL, delete the public object and the row. Run only after
 *                  checking the copy phase in the app.
 * Only images (jpeg, png, webp, gif) move; anything else is counted and left as it is.
 * Re-running a phase is harmless: it only picks up what is still to do. A circle whose offerings
 * changed meanwhile is skipped (counted as "conflict"), its new copies removed, and picked up on
 * the next run.
 *
 * Run as peerify on the box, from the app checkout's circles/ dir, with the app env (MONGODB_URI,
 * MINIO_*; MINIO_PRIVATE_BUCKET must be set explicitly). EXPECT_DB must match the database name:
 *   (set -a; . /srv/peerify/env/app.env; set +a; EXPECT_DB=peerify_staging bun scripts/move-offer-photos-private.ts)
 *   (... EXPECT_DB=peerify_staging bun scripts/move-offer-photos-private.ts --copy)
 *   (... EXPECT_DB=peerify_staging bun scripts/move-offer-photos-private.ts --delete-old)
 */

import { randomBytes } from "crypto";
import { MongoClient, ObjectId } from "mongodb";
import { Client as MinioClient } from "minio";
import { offerPhotoKey } from "../src/lib/media/offer-photo";
import {
    OFFER_PHOTO_MOVE_TYPES,
    legacyOfferPhotoUrls,
    movedOfferPhotoRef,
    publicKeyFromStorageUrl,
    rewriteOfferingPhotos,
} from "../src/lib/media/offer-photo-move";
import type { OfferPhotoRef } from "../src/lib/media/offer-photo";

const refuse = (message: string): never => {
    console.error(`Refusing to run: ${message}`);
    process.exit(1);
};

const args = new Set(process.argv.slice(2));
const copy = args.has("--copy");
const deleteOld = args.has("--delete-old");
if (copy && deleteOld) refuse("pass --copy or --delete-old, not both.");
for (const arg of args) {
    if (arg !== "--copy" && arg !== "--delete-old") refuse(`unknown argument ${arg}.`);
}
const mode = copy ? "COPY" : deleteOld ? "DELETE OLD" : "DRY RUN";

const MONGODB_URI = process.env.MONGODB_URI ?? refuse("MONGODB_URI is not set (source the app env).");
const EXPECT_DB = process.env.EXPECT_DB ?? refuse("set EXPECT_DB to the database name the URI points at.");
const accessKey = process.env.MINIO_ROOT_USERNAME ?? refuse("MINIO_ROOT_USERNAME is not set.");
const secretKey = process.env.MINIO_ROOT_PASSWORD ?? refuse("MINIO_ROOT_PASSWORD is not set.");
// No defaults for the buckets: copying into a bucket the app doesn't read would lose the photos.
const publicBucket = process.env.MINIO_BUCKET ?? refuse("MINIO_BUCKET is not set.");
const privateBucket = process.env.MINIO_PRIVATE_BUCKET ?? refuse("MINIO_PRIVATE_BUCKET is not set.");

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

const streamToBuffer = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
};

const objectExists = async (bucket: string, key: string): Promise<boolean> => {
    try {
        await minio.statObject(bucket, key);
        return true;
    } catch (err) {
        if (isMissing(err)) return false;
        throw err;
    }
};

type CircleDoc = { _id: ObjectId; tourTeamOfferings?: any[] };
type MoveRow = { _id?: ObjectId; circleId: string; publicKey: string; privateKey: string; oldUrl: string; createdAt: Date };

async function main() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    try {
        const db = client.db();
        if (db.databaseName !== EXPECT_DB) {
            refuse(`connected to "${db.databaseName}", EXPECT_DB is "${EXPECT_DB}".`);
        }
        for (const bucket of [publicBucket, privateBucket]) {
            if (!(await minio.bucketExists(bucket))) refuse("a configured bucket does not exist.");
        }
        console.log(`Database: ${db.databaseName}  mode: ${mode}`);

        const circles = db.collection<CircleDoc>("circles");
        const moves = db.collection<MoveRow>("offerPhotoMoves");

        const counts = {
            circlesWithLegacyPhotos: 0,
            legacyPhotos: 0,
            notOnStorage: 0,
            publicObjectMissing: 0,
            notAnImage: 0,
            copied: 0,
            conflicts: 0,
            movesPendingDelete: 0,
            publicDeleted: 0,
            privateCopyMissing: 0,
            oldUrlStillUsed: 0,
        };

        if (!deleteOld) {
            const docs = await circles
                .find({ "tourTeamOfferings.photos.url": { $regex: "^/storage/" } }, { projection: { _id: 1, tourTeamOfferings: 1 } })
                .toArray();
            for (const doc of docs) {
                const circleId = String(doc._id);
                const original = doc.tourTeamOfferings ?? [];
                const urls = legacyOfferPhotoUrls(original).filter((url) => url.startsWith("/storage/"));
                if (urls.length === 0) continue;
                counts.circlesWithLegacyPhotos += 1;
                const moved = new Map<string, OfferPhotoRef>();
                const rows: MoveRow[] = [];

                for (const url of urls) {
                    counts.legacyPhotos += 1;
                    const publicKey = publicKeyFromStorageUrl(url);
                    if (!publicKey) {
                        counts.notOnStorage += 1;
                        continue;
                    }
                    let stat;
                    try {
                        stat = await minio.statObject(publicBucket, publicKey);
                    } catch (err) {
                        if (!isMissing(err)) throw err;
                        counts.publicObjectMissing += 1;
                        continue;
                    }
                    const contentType = String(stat.metaData?.["content-type"] ?? "");
                    if (!OFFER_PHOTO_MOVE_TYPES[contentType]) {
                        counts.notAnImage += 1;
                        continue;
                    }
                    if (!copy) continue;
                    const buffer = await streamToBuffer(await minio.getObject(publicBucket, publicKey));
                    const ref = movedOfferPhotoRef(circleId, randomBytes(16).toString("hex"), contentType);
                    const privateKey = offerPhotoKey(ref);
                    await minio.putObject(privateBucket, privateKey, buffer, buffer.length, { "Content-Type": contentType });
                    const written = await minio.statObject(privateBucket, privateKey);
                    if (written.size !== buffer.length || buffer.length !== stat.size) {
                        await minio.removeObject(privateBucket, privateKey);
                        for (const row of rows) await minio.removeObject(privateBucket, row.privateKey);
                        throw new Error("Size check failed after copying a photo; stopped. Nothing was rewritten for its circle.");
                    }
                    moved.set(url, ref);
                    rows.push({ circleId, publicKey, privateKey, oldUrl: url, createdAt: new Date() });
                }

                if (!copy || moved.size === 0) continue;
                // Only if the offerings are still exactly what this run read.
                const res = await circles.updateOne(
                    { _id: doc._id, tourTeamOfferings: original },
                    { $set: { tourTeamOfferings: rewriteOfferingPhotos(original, moved) } },
                );
                if (res.modifiedCount !== 1) {
                    counts.conflicts += 1;
                    for (const row of rows) await minio.removeObject(privateBucket, row.privateKey);
                    continue;
                }
                await moves.insertMany(rows);
                counts.copied += rows.length;
            }
        }

        const pending = await moves.find({}).toArray();
        counts.movesPendingDelete = pending.length;
        if (deleteOld) {
            for (const row of pending) {
                if (!(await objectExists(privateBucket, row.privateKey))) {
                    counts.privateCopyMissing += 1;
                    continue;
                }
                const stillUsed = ObjectId.isValid(row.circleId)
                    ? await circles.findOne(
                          { _id: new ObjectId(row.circleId), "tourTeamOfferings.photos.url": row.oldUrl },
                          { projection: { _id: 1 } },
                      )
                    : null;
                if (stillUsed) {
                    counts.oldUrlStillUsed += 1;
                    continue;
                }
                try {
                    await minio.removeObject(publicBucket, row.publicKey);
                } catch (err) {
                    if (!isMissing(err)) throw err;
                }
                await moves.deleteOne({ _id: row._id });
                counts.publicDeleted += 1;
            }
        }

        console.log(`circles with /storage offer photos:        ${counts.circlesWithLegacyPhotos}`);
        console.log(`/storage offer photos (before this run):   ${counts.legacyPhotos}`);
        console.log(`  not on /storage (left as they are):      ${counts.notOnStorage}`);
        console.log(`  public object missing (left as they are): ${counts.publicObjectMissing}`);
        console.log(`  not an image (left as they are):         ${counts.notAnImage}`);
        if (copy) {
            console.log(`copied now:                                ${counts.copied}`);
            console.log(`conflicts (retry later):                   ${counts.conflicts}`);
        }
        console.log(`moved, public original not yet deleted:    ${counts.movesPendingDelete} (before this run)`);
        if (deleteOld) {
            console.log(`public originals deleted now:              ${counts.publicDeleted}`);
            console.log(`private copy missing (kept public):        ${counts.privateCopyMissing}`);
            console.log(`old URL still in use (kept public):        ${counts.oldUrlStillUsed}`);
        }
        if (!copy && !deleteOld) {
            console.log("Dry run only. Nothing was changed. Next: --copy, check the app, then --delete-old.");
        }
    } finally {
        await client.close();
    }
}

main().catch((err) => {
    // Only the error's name and message: no URIs, keys or document contents.
    console.error(`Failed: ${(err as Error)?.name}: ${(err as Error)?.message}`);
    process.exit(1);
});
