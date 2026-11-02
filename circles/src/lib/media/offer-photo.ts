// Offer photos in the private bucket (Tim, 2026-10-28: offer photos are for logged-in viewers
// only). Each photo has a stable address, /api/offer-photo/<circle id>/<file>, that the route
// serves only to a signed-in viewer and only while the circle still has the photo. The object key
// is derived from that address (offer-photos/<circle id>/<file>), so nothing else is stored and
// no key ever needs to reach a browser. Photos saved before this keep their /storage URLs until
// scripts/move-offer-photos-private.ts moves them.

export const OFFER_PHOTO_FOLDER = "offer-photos";
const URL_PREFIX = "/api/offer-photo/";

const CIRCLE_ID_PATTERN = /^[0-9a-f]{24}$/;
// What savePrivateFile names an image: 32 random hex characters and the detected extension.
const FILE_PATTERN = /^[0-9a-f]{32}\.(jpg|jpeg|png|webp|gif)$/;

export type OfferPhotoRef = { circleId: string; file: string };

// Also the file names of space photos (lib/media/space-photo.ts).
export const isPhotoFileName = (file: string): boolean => FILE_PATTERN.test(file);

export const isOfferPhotoRef = (circleId: string, file: string): boolean =>
    CIRCLE_ID_PATTERN.test(circleId) && FILE_PATTERN.test(file);

export const offerPhotoFolder = (circleId: string): string => `${OFFER_PHOTO_FOLDER}/${circleId}`;

export const offerPhotoKey = ({ circleId, file }: OfferPhotoRef): string => `${OFFER_PHOTO_FOLDER}/${circleId}/${file}`;

export const offerPhotoUrl = ({ circleId, file }: OfferPhotoRef): string => `${URL_PREFIX}${circleId}/${file}`;

export const parseOfferPhotoUrl = (url: unknown): OfferPhotoRef | null => {
    if (typeof url !== "string" || !url.startsWith(URL_PREFIX)) return null;
    const [circleId, file, ...rest] = url.slice(URL_PREFIX.length).split("/");
    if (rest.length > 0 || !circleId || !file || !isOfferPhotoRef(circleId, file)) return null;
    return { circleId, file };
};

// The private key savePrivateFile returned, as a photo of this circle; null if it isn't one.
export const offerPhotoRefFromKey = (circleId: string, key: string): OfferPhotoRef | null => {
    const prefix = `${offerPhotoFolder(circleId)}/`;
    if (!key.startsWith(prefix)) return null;
    const file = key.slice(prefix.length);
    return isOfferPhotoRef(circleId, file) ? { circleId, file } : null;
};
