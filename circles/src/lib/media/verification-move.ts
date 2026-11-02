// Pure helpers for scripts/move-verification-attachments-private.ts: moving verification
// attachments saved before 6dc95547 from the public bucket (/storage/...) to the private one.
// Kept here, without I/O, so the rewrite of a message's attachments can be unit tested.

import type { FileInfo, PrivateVerificationAttachment } from "@/models/models";

export type StoredVerificationAttachment = FileInfo | PrivateVerificationAttachment;

// An attachment still served from the public bucket.
export const isPublicAttachment = (attachment: StoredVerificationAttachment): attachment is FileInfo =>
    typeof (attachment as FileInfo).url === "string" && typeof (attachment as PrivateVerificationAttachment).key !== "string";

// Copied to the private bucket, public original not yet deleted.
export const isMovedPendingDelete = (
    attachment: StoredVerificationAttachment,
): attachment is PrivateVerificationAttachment & { movedFrom: string } =>
    typeof (attachment as PrivateVerificationAttachment).key === "string" &&
    typeof (attachment as PrivateVerificationAttachment).movedFrom === "string";

// "/storage/<circle id>/<name>" → "<circle id>/<name>". Anything else (/uploads/... from local dev
// storage, external URLs) has no public MinIO object to move.
export const publicKeyFromStorageUrl = (url: string): string | null => {
    if (!url.startsWith("/storage/")) return null;
    const key = url.slice("/storage/".length).split(/[?#]/)[0];
    return /^[A-Za-z0-9_-]+\/[^/]/.test(key) && !key.includes("..") ? key : null;
};

// Same folder as savePrivateFile uses for new uploads: verification/<owner circle id>/, which is
// the public key's first segment (saveFile stored attachments under the applicant's circle id).
export const privateKeyForMove = (publicKey: string, randomHex: string): string => {
    const [folder, ...rest] = publicKey.split("/");
    if (!/^[A-Za-z0-9_-]+$/.test(folder) || !/^[0-9a-f]{32}$/.test(randomHex)) {
        throw new Error("Refusing to build a private key for this attachment");
    }
    const extension = (rest.join("/").match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? "").toLowerCase();
    return `verification/${folder}/${randomHex}${extension}`;
};

export const movedAttachment = (
    attachment: FileInfo,
    privateKey: string,
    contentType: string,
    size: number,
): PrivateVerificationAttachment & { movedFrom: string } => ({
    key: privateKey,
    originalName: attachment.originalName || attachment.fileName || "file",
    contentType,
    size,
    movedFrom: attachment.url,
});

export const withoutMovedFrom = (attachment: PrivateVerificationAttachment): PrivateVerificationAttachment => {
    const { movedFrom: _movedFrom, ...rest } = attachment;
    return rest;
};
