// Photos of private spaces (item 4), like offer photos (lib/media/offer-photo.ts): in the private
// bucket, behind a stable address /api/space-photo/<space id>/<file> that checks who is asking
// (Tim, 2026-10-28). The key is derived from the address, space-photos/<space id>/<file>, so a
// space's photos sit in one folder that deleting the space or the account removes by prefix.
//
// Who may see them (canViewSpacePhoto, lib/data/space.ts): the owner and platform admins always;
// other signed-in viewers only while the space is on the map. Never logged out.

import { isPhotoFileName } from "./offer-photo";

export const SPACE_PHOTO_FOLDER = "space-photos";
export const SPACE_PHOTOS_MAX = 5;
const URL_PREFIX = "/api/space-photo/";
const SPACE_ID_PATTERN = /^[0-9a-f]{24}$/;

export type SpacePhotoRef = { spaceId: string; file: string };

export const isSpacePhotoRef = (spaceId: string, file: string): boolean =>
    SPACE_ID_PATTERN.test(spaceId) && isPhotoFileName(file);

export const spacePhotoFolder = (spaceId: string): string => `${SPACE_PHOTO_FOLDER}/${spaceId}`;

export const spacePhotoKey = ({ spaceId, file }: SpacePhotoRef): string => `${SPACE_PHOTO_FOLDER}/${spaceId}/${file}`;

export const spacePhotoUrl = ({ spaceId, file }: SpacePhotoRef): string => `${URL_PREFIX}${spaceId}/${file}`;

export const parseSpacePhotoUrl = (url: unknown): SpacePhotoRef | null => {
    if (typeof url !== "string" || !url.startsWith(URL_PREFIX)) return null;
    const [spaceId, file, ...rest] = url.slice(URL_PREFIX.length).split("/");
    if (rest.length > 0 || !spaceId || !file || !isSpacePhotoRef(spaceId, file)) return null;
    return { spaceId, file };
};

export const spacePhotoRefFromKey = (spaceId: string, key: string): SpacePhotoRef | null => {
    const prefix = `${spacePhotoFolder(spaceId)}/`;
    if (!key.startsWith(prefix)) return null;
    const file = key.slice(prefix.length);
    return isSpacePhotoRef(spaceId, file) ? { spaceId, file } : null;
};

// Shown under the photo picker (Tim's wording, 2026-10-28).
export const SPACE_PHOTO_WARNING =
    "Don't upload photos that could reveal where you live: house fronts, street views, house numbers, recognisable landmarks.";
