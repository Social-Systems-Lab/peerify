// file storage

import fs from "fs-extra";
import path from "path";
import { Client as MinioClient } from "minio";
import { randomBytes } from "crypto";
import { sanitizeUpload } from "@/lib/media/sanitize-image";

const resolveMinioHost = () => {
    const configuredHost = process.env.MINIO_HOST || "127.0.0.1";
    if (process.env.NODE_ENV !== "production" && (configuredHost === "db" || configuredHost === "minio")) {
        return "127.0.0.1";
    }
    return configuredHost;
};

const resolveFileExtension = (originalName?: string, mimeType?: string) => {
    const extFromName = originalName ? path.extname(originalName).toLowerCase() : "";
    if (extFromName) {
        return extFromName;
    }
    const mimeMap: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "application/pdf": ".pdf",
    };
    return mimeType ? mimeMap[mimeType] || "" : "";
};

const minioClient = new MinioClient({
    endPoint: resolveMinioHost(),
    port: parseInt(process.env.MINIO_PORT || "9000"),
    useSSL: false,
    // No default credentials. Unset keys make an anonymous client, whose requests MinIO refuses,
    // rather than a guess at the well-known default. (Not a throw: this runs at import, during builds.)
    accessKey: process.env.MINIO_ROOT_USERNAME ?? "",
    secretKey: process.env.MINIO_ROOT_PASSWORD ?? "",
});

const bucketName = process.env.MINIO_BUCKET || "circles";

export const isFile = (file: any) => {
    return file && typeof file === "object" && file.type && file.size;
};

export const listBuckets = async () => {
    return minioClient.listBuckets();
};

const ensureBucketExists = async () => {
    const exists = await minioClient.bucketExists(bucketName);
    if (!exists) {
        await minioClient.makeBucket(bucketName);
        const policy = {
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Principal: "*",
                    Action: ["s3:GetObject"],
                    Resource: [`arn:aws:s3:::${bucketName}/*`],
                },
            ],
        };
        await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
    }
};

const checkIfFileExists = async (circleId: string, fileName: string): Promise<boolean> => {
    try {
        const objectName = `${circleId}/${fileName}`;
        await minioClient.statObject(bucketName, objectName);
    } catch (error) {
        return false;
    }
    return true;
};

export type FileInfo = {
    originalName: string;
    fileName: string;
    url: string;
};

// The public bucket is served to anyone who has a URL (the /storage and /uploads routes check
// nothing), so an object name must not be guessable: 128 random bits, not a timestamp. Names used
// to be `${prefix}${Date.now()}`, where only the millisecond was unknown. The `${circleId}/`
// folder stays: account erasure and find-orphan-storage-prefixes.ts work by it.
const unguessableName = (prefix: string): string => `${prefix}-${randomBytes(16).toString("hex")}`;

export const saveFile = async (
    file: any,
    fileName: string,
    circleId: string,
    overwrite: boolean,
): Promise<FileInfo> => {    // --- Local filesystem override for development ---
    if (process.env.LOCAL_FS_STORAGE === "true" && process.env.NODE_ENV !== "production") {
        const uploadDir = path.join(process.cwd(), "public", "uploads");
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // Convert file → Buffer
        let buffer: Buffer;
        if (file instanceof Buffer) {
            buffer = file;
        } else if (typeof file.arrayBuffer === "function") {
            buffer = Buffer.from(await file.arrayBuffer());
        } else if (typeof file === "string" && file.startsWith("data:")) {
            const matches = file.match(/^data:(.+);base64,(.+)$/);
            buffer = Buffer.from(matches?.[2] ?? "", "base64");
        } else {
            buffer = Buffer.from(file);
        }

        const originalName = typeof file?.name === "string" ? file.name : fileName;
        // Strips image metadata (see sanitize-image.ts); throws for undecodable "images".
        const sanitized = await sanitizeUpload(buffer, file?.type, originalName);
        buffer = sanitized.buffer;
        const extension = sanitized.extension || resolveFileExtension(originalName, file?.type);
        const finalName = `${unguessableName(fileName)}${extension}`;
        const filePath = path.join(uploadDir, finalName);
        
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir, { recursive: true });
        }

        fs.writeFileSync(filePath, buffer);

        return {
            originalName,
            fileName: finalName,
            url: `/uploads/${finalName}`,
        };
    }
    // --- End local override ---

    await ensureBucketExists();
    if (!overwrite) {
        let fileExists = await checkIfFileExists(circleId, fileName);
        if (fileExists) {
            throw new Error("File already exists");
        }
    }

    const objectBaseName = unguessableName(fileName);
    let buffer: Buffer;
    let contentType = "application/octet-stream";
    let originalName = "unknown";

    try {
        console.log("saveFile: file type is", typeof file, file?.constructor?.name);

        // Handle different types of file objects
        if (file instanceof Buffer) {
            // Already a buffer
            buffer = file;
            console.log("saveFile: file is a Buffer");
        } else if (typeof file.arrayBuffer === "function") {
            // Browser File or Blob
            buffer = Buffer.from(await file.arrayBuffer());
            contentType = file.type || contentType;
            originalName = file.name || originalName;
            console.log("saveFile: file has arrayBuffer method");
        } else if (typeof file === "string" && file.startsWith("data:")) {
            // Data URL
            const matches = file.match(/^data:(.+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                contentType = matches[1];
                buffer = Buffer.from(matches[2], "base64");
                console.log("saveFile: file is a data URL");
            } else {
                throw new Error("Invalid data URL format");
            }
        } else if (Buffer.isBuffer(file)) {
            // Node.js Buffer
            buffer = file;
            console.log("saveFile: file is a Node.js Buffer");
        } else {
            // Try to convert to buffer as a last resort
            console.log("saveFile: trying to convert to buffer as last resort");
            buffer = Buffer.from(file);
        }

        console.log("saveFile: buffer length", buffer.length);

        // Strips image metadata (see sanitize-image.ts); throws for undecodable "images". The
        // stored extension and Content-Type follow the detected format, not the client's claim.
        const sanitized = await sanitizeUpload(buffer, contentType, originalName);
        buffer = sanitized.buffer;
        contentType = sanitized.contentType;
        const extension = sanitized.extension || resolveFileExtension(originalName, contentType);
        const objectName = `${circleId}/${objectBaseName}${extension}`;
        await minioClient.putObject(bucketName, objectName, buffer, buffer.length, {
            "Content-Type": contentType,
        });

        let fileInfo: FileInfo = {
            originalName: originalName,
            fileName: `${objectBaseName}${extension}`,
            url: "/storage/" + objectName,
        };
        return fileInfo;
    } catch (error) {
        console.error("Error in saveFile:", error);
        throw error;
    }
};

// ---------------------------------------------------------------------------
// Peerify private media storage
//
// The "circles" bucket above is public-read and is served by the unauthenticated
// /storage/[...path] proxy. Audio originals + derivatives must NOT be reachable
// that way, so they live in a SEPARATE bucket with no public policy. Objects here
// are only ever streamed server-side through the signed /api/peerify/audio route.
// ---------------------------------------------------------------------------

const privateBucketName = process.env.MINIO_PRIVATE_BUCKET || "peerify-media";

let privateBucketEnsured = false;
const ensurePrivateBucket = async () => {
    if (privateBucketEnsured) return;
    const exists = await minioClient.bucketExists(privateBucketName);
    if (!exists) {
        await minioClient.makeBucket(privateBucketName);
        // Intentionally NO public bucket policy: objects stay private.
    }
    privateBucketEnsured = true;
};

export const putPrivateObject = async (key: string, buffer: Buffer, contentType: string): Promise<void> => {
    await ensurePrivateBucket();
    await minioClient.putObject(privateBucketName, key, buffer, buffer.length, {
        "Content-Type": contentType,
    });
};

// A file stored in the private bucket for a viewer-checked feature (verification attachments
// first). What callers store instead of a URL: the key never reaches a browser, viewers get a
// signed, short-lived link (lib/media/private-media-token.ts).
export type PrivateFileInfo = { key: string; originalName: string; contentType: string; size: number };

// "<feature>/<owner id>", e.g. "verification/<applicant circle id>": one folder per owner so
// account erasure can remove it by prefix.
const PRIVATE_FOLDER_PATTERN = /^[a-z][a-z-]*\/[A-Za-z0-9_-]+$/;

// Like saveFile, but into the private bucket under an unguessable name: the same sanitising
// (metadata stripped, type from the detected format), no public URL.
export const savePrivateFile = async (file: File, folder: string): Promise<PrivateFileInfo> => {
    if (!PRIVATE_FOLDER_PATTERN.test(folder)) {
        throw new Error(`Refusing private storage folder "${folder}"`);
    }
    const originalName = typeof file.name === "string" && file.name ? file.name : "file";
    const sanitized = await sanitizeUpload(
        Buffer.from(await file.arrayBuffer()),
        file.type || "application/octet-stream",
        originalName,
    );
    // The extension can come from the uploader's file name: keep it only if it's short and plain.
    const extension = sanitized.extension || resolveFileExtension(originalName, sanitized.contentType);
    const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
    const key = `${folder}/${randomBytes(16).toString("hex")}${safeExtension}`;
    await putPrivateObject(key, sanitized.buffer, sanitized.contentType);
    return { key, originalName, contentType: sanitized.contentType, size: sanitized.buffer.length };
};

export type PrivateObjectStat = { size: number; contentType: string };

export const statPrivateObject = async (key: string): Promise<PrivateObjectStat> => {
    await ensurePrivateBucket();
    const stat = await minioClient.statObject(privateBucketName, key);
    return {
        size: stat.size,
        contentType: (stat.metaData?.["content-type"] as string) || "application/octet-stream",
    };
};

// Returns a Node Readable stream for the object. When offset/length are provided
// a partial (byte-range) stream is returned — used to satisfy HTTP Range requests
// so native <audio> seeking works.
export const getPrivateObjectStream = async (
    key: string,
    offset?: number,
    length?: number,
): Promise<NodeJS.ReadableStream> => {
    await ensurePrivateBucket();
    if (typeof offset === "number" && typeof length === "number") {
        return minioClient.getPartialObject(privateBucketName, key, offset, length);
    }
    return minioClient.getObject(privateBucketName, key);
};

export const removePrivateObject = async (key: string): Promise<void> => {
    await ensurePrivateBucket();
    await minioClient.removeObject(privateBucketName, key);
};

// ---------------------------------------------------------------------------
// Bulk listing/removal, used by account erasure (account-erasure.ts).
// "public" is the circles bucket behind /storage/, "private" the audio bucket above.
// ---------------------------------------------------------------------------

export type StorageBucket = "public" | "private";

const resolveBucket = async (bucket: StorageBucket): Promise<string> => {
    if (bucket === "private") {
        await ensurePrivateBucket();
        return privateBucketName;
    }
    return bucketName;
};

// A prefix must name a whole "directory": non-empty, ending in "/", and not just "/". So "" can
// never list or empty a whole bucket, and "abc/" can't also match the objects of a circle "abcd".
const assertDirectoryPrefix = (prefix: string) => {
    if (typeof prefix !== "string" || prefix.length < 2 || !prefix.endsWith("/") || prefix.startsWith("/")) {
        throw new Error(`Refusing storage prefix "${prefix}": it must look like "<id>/"`);
    }
};

export const listObjectKeysByPrefix = async (bucket: StorageBucket, prefix: string): Promise<string[]> => {
    assertDirectoryPrefix(prefix);
    const name = await resolveBucket(bucket);
    const keys: string[] = [];
    for await (const obj of minioClient.listObjectsV2(name, prefix, true)) {
        if (obj.name) keys.push(obj.name);
    }
    return keys;
};

// Removes exactly these keys (missing ones are no error in S3/MinIO). Returns how many were asked for.
export const removeObjectKeys = async (bucket: StorageBucket, keys: string[]): Promise<number> => {
    const unique = [...new Set(keys.filter((k) => typeof k === "string" && k.length > 0))];
    if (unique.length === 0) return 0;
    const name = await resolveBucket(bucket);
    const failed: string[] = [];
    for (let i = 0; i < unique.length; i += 1000) {
        const results = await minioClient.removeObjects(name, unique.slice(i, i + 1000));
        for (const result of results ?? []) {
            if (result?.Error) failed.push(`${result.Error.Key ?? "?"}: ${result.Error.Code ?? "error"}`);
        }
    }
    if (failed.length > 0) {
        throw new Error(`Failed to remove ${failed.length} object(s) from ${bucket} storage: ${failed.slice(0, 5).join(", ")}`);
    }
    return unique.length;
};

// Function to delete a file from MinIO based on its URL
export const deleteFile = async (fileUrl: string): Promise<void> => {
    try {
        // Extract the object name from the URL
        // Assuming URL format like: http://host/storage/circleId/fileNameTimestamp
        // Or production format: https://circles.com/storage/circleId/fileNameTimestamp
        const urlPrefix = "/storage/";
        const objectNameIndex = fileUrl.indexOf(urlPrefix);
        if (objectNameIndex === -1) {
            console.log(`Skipping non-MinIO file delete: ${fileUrl}`);
            return;
        }
        const objectName = fileUrl.substring(objectNameIndex + urlPrefix.length);

        if (!objectName) {
            throw new Error(`Could not extract object name from URL: ${fileUrl}`);
        }

        console.log(`Attempting to delete object: ${objectName} from bucket: ${bucketName}`);
        await minioClient.removeObject(bucketName, objectName);
        console.log(`Successfully deleted object: ${objectName}`);
    } catch (error) {
        console.error(`Error deleting file ${fileUrl}:`, error);
        // Decide if we should throw the error or just log it
        // For now, let's re-throw to indicate failure
        throw error;
    }
};

// Removes files a save already uploaded when a later upload in the same save is rejected, so the
// failed save leaves no orphaned objects behind. Best effort: failures are logged, not thrown.
// Upload names carry a millisecond timestamp, so a new upload can't normally share a URL with a
// file the circle already uses; any URL in `inUseUrls` is skipped anyway, so a live file is never
// deleted even if the clock went backwards.
export const deleteUploadedFiles = async (fileUrls: string[], inUseUrls: Iterable<string> = []): Promise<void> => {
    const keep = new Set(inUseUrls);
    for (const fileUrl of fileUrls) {
        if (keep.has(fileUrl)) {
            console.warn(`Not cleaning up ${fileUrl}: the circle still uses it`);
            continue;
        }
        try {
            await deleteFile(fileUrl);
        } catch (error) {
            console.error(`Failed to clean up upload ${fileUrl}:`, error);
        }
    }
};

/** Every file URL a circle currently references (picture and cover images). */
type CircleFileRefs = { picture?: { url?: string }; images?: { fileInfo?: { url?: string } }[] };

export const getCircleFileUrls = (circle?: CircleFileRefs | null): string[] =>
    [circle?.picture?.url, ...(circle?.images ?? []).map((image) => image.fileInfo?.url)].filter(
        (url): url is string => Boolean(url),
    );
