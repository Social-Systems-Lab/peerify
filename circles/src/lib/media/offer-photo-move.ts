// Pure helpers for scripts/move-offer-photos-private.ts: moving offer photos saved before
// 617d5f90 from the public bucket (/storage/...) to the private one, behind /api/offer-photo.
// Kept here, without I/O, so the rewrite of a circle's offerings can be unit tested.

import type { FileInfo } from "@/models/models";
import { publicKeyFromStorageUrl } from "./verification-move";
import { OfferPhotoRef, isOfferPhotoRef, offerPhotoUrl, parseOfferPhotoUrl } from "./offer-photo";

export { publicKeyFromStorageUrl };

export const OFFER_PHOTO_MOVE_TYPES: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
};

// AVIF moves only if the bytes agree: an ISO media file ("ftyp" box first) whose major brand, or
// one of its compatible brands, is avif or avis. A HEIC (brand heic, which browsers mostly can't
// show) stored as image/avif would not move.
export const isAvifBytes = (bytes: Uint8Array): boolean => {
    if (bytes.length < 16) return false;
    const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (text(4) !== "ftyp") return false;
    const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    const end = Math.min(boxSize, bytes.length);
    if (boxSize < 16) return false;
    const brands = [text(8)];
    for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(text(offset));
    return brands.some((brand) => brand === "avif" || brand === "avis");
};

type OfferingWithPhotos = { photos?: FileInfo[] | null } & Record<string, unknown>;

// Every photo URL on a circle's offerings still on /storage, once each.
export const legacyOfferPhotoUrls = (offerings: OfferingWithPhotos[] | undefined): string[] => {
    const urls = new Set<string>();
    for (const offering of offerings ?? []) {
        for (const photo of offering.photos ?? []) {
            if (typeof photo?.url === "string" && !parseOfferPhotoUrl(photo.url)) urls.add(photo.url);
        }
    }
    return [...urls];
};

// The new photo for a moved one: the circle's folder, a random name and the extension of the
// stored type (not of the old name).
export const movedOfferPhotoRef = (circleId: string, randomHex: string, contentType: string): OfferPhotoRef => {
    const extension = OFFER_PHOTO_MOVE_TYPES[contentType];
    const ref = { circleId, file: `${randomHex}${extension ?? ""}` };
    if (!extension || !isOfferPhotoRef(ref.circleId, ref.file)) {
        throw new Error("Refusing to build an offer photo name for this photo");
    }
    return ref;
};

// The offerings with each moved photo's URL swapped for its new address. The original name is
// kept; the old file name is replaced by the new one. Photos not in `moved` are untouched.
export const rewriteOfferingPhotos = <T extends OfferingWithPhotos>(
    offerings: T[],
    moved: Map<string, OfferPhotoRef>,
): T[] =>
    offerings.map((offering) =>
        offering.photos?.some((photo) => moved.has(photo?.url))
            ? {
                  ...offering,
                  photos: offering.photos.map((photo) => {
                      const ref = moved.get(photo?.url);
                      if (!ref) return photo;
                      return {
                          url: offerPhotoUrl(ref),
                          fileName: ref.file,
                          ...(photo.originalName ? { originalName: photo.originalName } : {}),
                      };
                  }),
              }
            : offering,
    );
