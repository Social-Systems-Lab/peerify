// sanitize-image.ts - strips all metadata from uploaded images before they are stored.
//
// Every upload is served byte-for-byte to anyone via /storage, so anything embedded in the file
// reaches every viewer: EXIF (GPS position, camera serial, capture time), XMP, IPTC and ICC.
// saveFile() runs every upload through sanitizeUpload():
// - the format is detected from the bytes, never from the client's type or file name;
// - supported images are re-encoded in the same format with no metadata, after .rotate() bakes
//   the EXIF orientation into the pixels (dropping the tag alone would leave photos sideways);
// - the stored extension and Content-Type come from the detected format, so a client can't
//   store e.g. an SVG (script-capable) under an image name;
// - anything that claims to be an image but can't be decoded into a supported format is
//   rejected (fail closed) rather than stored as-is;
// - non-images (PDFs, other chat attachments) pass through unchanged.
import path from "path";
import sharp from "sharp";

export class UnsupportedImageError extends Error {
    constructor() {
        super("Unsupported image format");
        this.name = "UnsupportedImageError";
    }
}

export type SanitizedUpload = {
    buffer: Buffer;
    contentType: string;
    extension: string; // with leading dot, or "" to keep the caller's own choice
    sanitized: boolean; // true when the bytes were re-encoded as an image
};

type OutputFormat = "jpeg" | "png" | "webp" | "gif" | "avif" | "tiff";

const OUTPUT: Record<OutputFormat, { contentType: string; extension: string }> = {
    jpeg: { contentType: "image/jpeg", extension: ".jpg" },
    png: { contentType: "image/png", extension: ".png" },
    webp: { contentType: "image/webp", extension: ".webp" },
    gif: { contentType: "image/gif", extension: ".gif" },
    avif: { contentType: "image/avif", extension: ".avif" },
    tiff: { contentType: "image/tiff", extension: ".tiff" },
};

// sharp's detected input format -> the format we re-encode to. "heif" covers AVIF (decodable) and
// HEIC (not decodable by the bundled libvips, so it fails at encode time and is rejected).
const OUTPUT_FOR_INPUT: Record<string, OutputFormat> = {
    jpeg: "jpeg",
    png: "png",
    webp: "webp",
    gif: "gif",
    heif: "avif",
    tiff: "tiff",
};

const IMAGE_EXTENSIONS = /^\.(jpe?g|jfif|pjpeg|png|apng|webp|gif|avif|heic|heif|tiff?|bmp|ico|svgz?|jxl|jp2)$/i;

/** True when the client presents the upload as an image, by declared type or by file name. */
export const claimsToBeImage = (declaredType?: string, originalName?: string): boolean =>
    (typeof declaredType === "string" && declaredType.toLowerCase().startsWith("image/")) ||
    (typeof originalName === "string" && IMAGE_EXTENSIONS.test(path.extname(originalName)));

const encode = (image: sharp.Sharp, format: OutputFormat): sharp.Sharp => {
    switch (format) {
        case "jpeg":
            return image.jpeg({ quality: 90, mozjpeg: true });
        case "png":
            return image.png();
        case "webp":
            return image.webp({ quality: 90 });
        case "gif":
            return image.gif();
        case "avif":
            return image.avif({ quality: 60 });
        case "tiff":
            return image.tiff();
    }
};

/**
 * Returns the bytes to store. Throws UnsupportedImageError for an upload that claims to be an
 * image but isn't a decodable, supported one.
 */
export const sanitizeUpload = async (
    buffer: Buffer,
    declaredType?: string,
    originalName?: string,
): Promise<SanitizedUpload> => {
    const claimsImage = claimsToBeImage(declaredType, originalName);

    let format: OutputFormat | undefined;
    let pages = 1;
    try {
        const meta = await sharp(buffer).metadata();
        format = meta.format ? OUTPUT_FOR_INPUT[meta.format] : undefined;
        pages = meta.pages ?? 1;
    } catch {
        format = undefined; // not something sharp can read
    }

    if (!format) {
        // SVG lands here too (sharp reads it, but it's not an allowed output), so an .svg upload
        // is rejected rather than stored and later served as a same-origin document.
        if (claimsImage) throw new UnsupportedImageError();
        return { buffer, contentType: declaredType || "application/octet-stream", extension: "", sanitized: false };
    }

    try {
        const animated = pages > 1 && (format === "gif" || format === "webp");
        // No withMetadata()/keepExif()/keepIccProfile(): sharp writes no EXIF, XMP, IPTC or ICC.
        const output = await encode(sharp(buffer, { animated }).rotate(), format).toBuffer();
        return { buffer: output, ...OUTPUT[format], sanitized: true };
    } catch {
        // Recognised as an image but not encodable (e.g. HEIC): never fall back to the original.
        throw new UnsupportedImageError();
    }
};
