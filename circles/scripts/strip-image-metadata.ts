/**
 * One-off: strip metadata from images already in a public MinIO bucket.
 *
 * Uploads were stored byte-for-byte until saveFile started running them through
 * sanitizeUpload (src/lib/media/sanitize-image.ts), and /storage serves them unchanged, so older
 * photos still carry EXIF (GPS included), XMP or IPTC. This rewrites each such image with the same
 * sanitizer new uploads get (orientation baked in, no EXIF/XMP/IPTC/ICC), at the SAME key with the
 * SAME Content-Type, so no database references change. Images with only an ICC profile are left
 * alone (no personal data; avoids re-encoding them for nothing).
 *
 * Anything with an image extension that can't be decoded, or whose re-encode would change format
 * (HEIC -> AVIF), is skipped and listed, never deleted. Prints keys and yes/no counts only, never
 * EXIF values or coordinates. Supersedes scripts/strip-offer-photo-exif.ts.
 *
 * Dry run (default, no writes):
 *   ENV_FILE=<.env.local> EXPECT_BUCKET=<bucket> bun scripts/strip-image-metadata.ts
 * Apply (back the bucket up first, e.g. mc mirror):
 *   ENV_FILE=<.env.local> EXPECT_BUCKET=<bucket> APPLY=1 bun scripts/strip-image-metadata.ts
 *
 * EXPECT_BUCKET must equal the MINIO_BUCKET in ENV_FILE, so a wrong env file aborts instead of
 * touching the other environment's bucket (staging and prod share one MinIO).
 */

import fs from "fs";
import { Client as MinioClient } from "minio";
import sharp from "sharp";
import { sanitizeUpload } from "../src/lib/media/sanitize-image";

const envFile = process.env.ENV_FILE;
const expectBucket = process.env.EXPECT_BUCKET;
const apply = process.env.APPLY === "1";

if (!envFile || !expectBucket) {
    console.error("Refusing to run: set ENV_FILE and EXPECT_BUCKET.");
    process.exit(1);
}

const env: Record<string, string> = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = /^(MINIO_[A-Z_]+)=["']?([^"'\n]*)["']?\s*$/.exec(line);
    if (m) env[m[1]] = m[2];
}
const bucket = env.MINIO_BUCKET || "circles";
if (bucket !== expectBucket) {
    console.error(`Refusing to run: ${envFile} points at bucket "${bucket}", EXPECT_BUCKET is "${expectBucket}".`);
    process.exit(1);
}

const minio = new MinioClient({
    endPoint: env.MINIO_HOST || "127.0.0.1",
    port: Number(env.MINIO_PORT || 9000),
    useSSL: false,
    accessKey: env.MINIO_ROOT_USERNAME,
    secretKey: env.MINIO_ROOT_PASSWORD,
});

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|tiff?|heic|heif|avif)$/i;

// Same GPS test as /home/tim/scan-image-metadata.mjs: a non-empty GPS IFD (tag 0x8825) in the
// EXIF block, or GPS fields in XMP.
function exifHasGps(exif: Buffer): boolean {
    let buf = exif;
    if (buf.subarray(0, 6).toString("latin1") === "Exif\0\0") buf = buf.subarray(6);
    if (buf.length < 8) return false;
    const order = buf.subarray(0, 2).toString("latin1");
    const le = order === "II";
    if (!le && order !== "MM") return false;
    const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
    const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
    try {
        const ifd0 = u32(4);
        const count = u16(ifd0);
        for (let i = 0; i < count; i++) {
            const entry = ifd0 + 2 + i * 12;
            if (u16(entry) === 0x8825) {
                const gpsIfd = u32(entry + 8);
                return gpsIfd > 0 && gpsIfd + 2 <= buf.length && u16(gpsIfd) > 0;
            }
        }
    } catch {
        return false;
    }
    return false;
}

const hasGps = (meta: sharp.Metadata) =>
    Boolean(
        (meta.exif && exifHasGps(meta.exif)) ||
            (meta.xmp && /GPS(Latitude|Longitude|Position)/i.test(meta.xmp.toString("utf8"))),
    );

async function readObject(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await minio.getObject(bucket, key)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
}

async function listImageKeys(): Promise<string[]> {
    const keys: string[] = [];
    for await (const obj of minio.listObjectsV2(bucket, "", true)) {
        if (obj.name && IMAGE_EXT.test(obj.name)) keys.push(obj.name);
    }
    return keys;
}

async function countGps(keys: string[]): Promise<{ gps: number; unreadable: number }> {
    let gps = 0;
    let unreadable = 0;
    for (const key of keys) {
        try {
            if (hasGps(await sharp(await readObject(key)).metadata())) gps++;
        } catch {
            unreadable++;
        }
    }
    return { gps, unreadable };
}

async function main() {
    console.log(`Bucket: ${bucket}  mode: ${apply ? "APPLY" : "DRY RUN"}`);
    const keys = await listImageKeys();

    let clean = 0;
    let withMetadata = 0;
    let withGps = 0;
    let rewritten = 0;
    const skipped: string[] = [];

    for (const key of keys) {
        let original: Buffer;
        let meta: sharp.Metadata;
        try {
            original = await readObject(key);
            meta = await sharp(original).metadata();
        } catch {
            skipped.push(`${key}  (undecodable)`);
            continue;
        }
        if (!meta.exif && !meta.xmp && !meta.iptc) {
            clean++;
            continue;
        }
        withMetadata++;
        if (hasGps(meta)) withGps++;

        const stat = await minio.statObject(bucket, key);
        const contentType = (stat.metaData?.["content-type"] as string) || "application/octet-stream";

        let output: Buffer;
        try {
            const sanitized = await sanitizeUpload(original, contentType, key);
            const outMeta = await sharp(sanitized.buffer).metadata();
            if (!sanitized.sanitized || outMeta.format !== meta.format) {
                skipped.push(`${key}  (re-encode would change format ${meta.format} -> ${outMeta.format})`);
                continue;
            }
            if (outMeta.exif || outMeta.xmp || outMeta.iptc) {
                skipped.push(`${key}  (metadata survived re-encode)`);
                continue;
            }
            output = sanitized.buffer;
        } catch {
            skipped.push(`${key}  (could not re-encode)`);
            continue;
        }

        if (apply) {
            await minio.putObject(bucket, key, output, output.length, { "Content-Type": contentType });
            rewritten++;
        }
    }

    console.log(`images: ${keys.length}  without EXIF/XMP/IPTC: ${clean}  with: ${withMetadata} (GPS: ${withGps})`);
    console.log(
        apply
            ? `rewritten: ${rewritten}`
            : `would rewrite: ${withMetadata - skipped.filter((s) => !s.endsWith("(undecodable)")).length}`,
    );
    console.log(`skipped: ${skipped.length}`);
    for (const line of skipped) console.log(`  ${line}`);

    const after = await countGps(keys);
    console.log(
        `${apply ? "after rewrite" : "current"} GPS count: ${after.gps} (unreadable: ${after.unreadable})${apply ? " - expected 0 unless skipped above" : ""}`,
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
