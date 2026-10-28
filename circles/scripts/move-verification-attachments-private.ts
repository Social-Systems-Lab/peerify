/**
 * Moves verification attachments saved before 6dc95547 from the public bucket (served to anyone
 * with the URL by /storage) to the private bucket, where the app only hands out signed 15-minute
 * links (src/lib/media/private-media-token.ts). New attachments already go there.
 *
 * Three modes. Each run prints counts only: no keys, URLs, ids, names or file names.
 *   (default)      dry run: what the copy and delete phases would do; no writes.
 *   --copy         for each public attachment: read the public object, write it to the private
 *                  bucket under verification/<owner circle id>/<random>, check the size, then
 *                  rewrite the message's attachment to { key, originalName, contentType, size,
 *                  movedFrom: <old url> }. The public object is NOT touched. From here on viewers
 *                  get signed links; the old URL still works.
 *   --delete-old   for each moved attachment: if its private copy exists, delete the public object
 *                  and drop movedFrom. Run only after checking the copy phase in the app.
 * Re-running a phase is harmless: it only picks up what is still to do. A message whose
 * attachments changed meanwhile is skipped (counted as "conflict") and picked up next run.
 *
 * Run as peerify on the box, from the app checkout's circles/ dir, with the app env (MONGODB_URI,
 * MINIO_*; MINIO_PRIVATE_BUCKET must be set explicitly). EXPECT_DB must match the database name:
 *   (set -a; . /srv/peerify/env/app.env; set +a; EXPECT_DB=peerify_staging bun scripts/move-verification-attachments-private.ts)
 *   (... EXPECT_DB=peerify_staging bun scripts/move-verification-attachments-private.ts --copy)
 *   (... EXPECT_DB=peerify_staging bun scripts/move-verification-attachments-private.ts --delete-old)
 */

import { randomBytes } from "crypto";
import { MongoClient, ObjectId } from "mongodb";
import { Client as MinioClient } from "minio";
import {
    isMovedPendingDelete,
    isPublicAttachment,
    movedAttachment,
    privateKeyForMove,
    publicKeyFromStorageUrl,
    withoutMovedFrom,
    type StoredVerificationAttachment,
} from "../src/lib/media/verification-move";

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
// No defaults for the buckets: copying into a bucket the app doesn't read would lose the files.
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

type MessageDoc = { _id: ObjectId; attachments?: StoredVerificationAttachment[] };

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

        const messages = db.collection<MessageDoc>("verificationMessages");
        const docs = await messages
            .find({ "attachments.0": { $exists: true } }, { projection: { _id: 1, attachments: 1 } })
            .toArray();

        const counts = {
            messagesWithAttachments: docs.length,
            publicAttachments: 0,
            publicNotOnStorage: 0,
            publicObjectMissing: 0,
            movedPendingDelete: 0,
            privateDone: 0,
            copied: 0,
            publicDeleted: 0,
            privateCopyMissing: 0,
            conflicts: 0,
        };

        for (const doc of docs) {
            const original = doc.attachments ?? [];
            const next: StoredVerificationAttachment[] = [];
            let changed = false;

            for (const attachment of original) {
                if (isPublicAttachment(attachment)) {
                    counts.publicAttachments += 1;
                    const publicKey = publicKeyFromStorageUrl(attachment.url);
                    if (!publicKey) {
                        counts.publicNotOnStorage += 1;
                        next.push(attachment);
                        continue;
                    }
                    let stat;
                    try {
                        stat = await minio.statObject(publicBucket, publicKey);
                    } catch (err) {
                        if (!isMissing(err)) throw err;
                        counts.publicObjectMissing += 1;
                        next.push(attachment);
                        continue;
                    }
                    if (!copy) {
                        next.push(attachment);
                        continue;
                    }
                    const buffer = await streamToBuffer(await minio.getObject(publicBucket, publicKey));
                    const contentType = (stat.metaData?.["content-type"] as string) || "application/octet-stream";
                    const privateKey = privateKeyForMove(publicKey, randomBytes(16).toString("hex"));
                    await minio.putObject(privateBucket, privateKey, buffer, buffer.length, { "Content-Type": contentType });
                    const written = await minio.statObject(privateBucket, privateKey);
                    if (written.size !== buffer.length || buffer.length !== stat.size) {
                        await minio.removeObject(privateBucket, privateKey);
                        throw new Error("Size check failed after copying an attachment; stopped. Nothing was rewritten for it.");
                    }
                    next.push(movedAttachment(attachment, privateKey, contentType, buffer.length));
                    counts.copied += 1;
                    changed = true;
                } else if (isMovedPendingDelete(attachment)) {
                    counts.movedPendingDelete += 1;
                    if (!deleteOld) {
                        next.push(attachment);
                        continue;
                    }
                    if (!(await objectExists(privateBucket, attachment.key))) {
                        counts.privateCopyMissing += 1;
                        next.push(attachment);
                        continue;
                    }
                    const publicKey = publicKeyFromStorageUrl(attachment.movedFrom);
                    if (publicKey) {
                        try {
                            await minio.removeObject(publicBucket, publicKey);
                        } catch (err) {
                            if (!isMissing(err)) throw err;
                        }
                    }
                    next.push(withoutMovedFrom(attachment));
                    counts.publicDeleted += 1;
                    changed = true;
                } else {
                    counts.privateDone += 1;
                    next.push(attachment);
                }
            }

            if (changed) {
                // Only if the attachments are still exactly what this run read.
                const res = await messages.updateOne(
                    { _id: doc._id, attachments: original },
                    { $set: { attachments: next } },
                );
                if (res.modifiedCount !== 1) {
                    counts.conflicts += 1;
                    // A copy whose rewrite didn't land would be an orphan: remove it again.
                    for (const attachment of next) {
                        if (isMovedPendingDelete(attachment) && !original.includes(attachment)) {
                            await minio.removeObject(privateBucket, attachment.key);
                        }
                    }
                }
            }
        }

        console.log(`messages with attachments:                 ${counts.messagesWithAttachments}`);
        console.log(`public attachments (before this run):      ${counts.publicAttachments}`);
        console.log(`  not on /storage (left as they are):      ${counts.publicNotOnStorage}`);
        console.log(`  public object missing (left as they are): ${counts.publicObjectMissing}`);
        console.log(`moved, public original not yet deleted:    ${counts.movedPendingDelete}`);
        console.log(`private, done:                             ${counts.privateDone}`);
        if (copy) console.log(`copied now:                                ${counts.copied}`);
        if (deleteOld) {
            console.log(`public originals deleted now:              ${counts.publicDeleted}`);
            console.log(`private copy missing (kept public):        ${counts.privateCopyMissing}`);
        }
        if (copy || deleteOld) console.log(`conflicts (retry later):                   ${counts.conflicts}`);
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
