"use server";

// The owner's own spaces (see lib/data/space.ts). The owner is always the signed-in person: no
// action takes an owner from the client, and the data layer scopes every query to that DID, so
// another person's space id matches nothing. Errors are logged by name only: the input can hold
// a home's area and notes meant for Peerify. Private space photos are resolved here
// (resolveSpacePhotos) into their /api/space-photo addresses before the data layer stores them.

import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getRestrictedActionMessage } from "@/lib/auth/verification";
import {
    SPACES_PER_PERSON_MAX,
    SpaceView,
    createSpaceForOwner,
    deleteSpaceForOwner,
    getSpaceActor,
    getSpacePhotosForOwner,
    listSpacesForOwner,
    newSpaceId,
    updateSpaceForOwner,
} from "@/lib/data/space";
import { parseSpaceInput } from "@/lib/spaces/space-rules";
import { isFile, listObjectKeysByPrefix, removeObjectKeys, removePrivateObject, savePrivateFile } from "@/lib/data/storage";
import {
    SPACE_PHOTOS_MAX,
    parseSpacePhotoUrl,
    spacePhotoFolder,
    spacePhotoKey,
    spacePhotoRefFromKey,
    spacePhotoUrl,
} from "@/lib/media/space-photo";
import type { FileInfo } from "@/models/models";

export type SpaceActionResult = { success: true; spaces: SpaceView[] } | { success: false; message: string };

const NOT_SIGNED_IN = "You need to be logged in to manage spaces.";
const NOT_FOUND = "That space wasn't found. It may have been deleted.";
const TOO_MANY_PHOTOS = `You can add up to ${SPACE_PHOTOS_MAX} photos.`;

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// What the space form sends as photos (MultiImageUploader's ImageItem): a new file, or a photo
// already saved, by its address.
type DraftPhoto = { file?: unknown; existingMediaUrl?: unknown; url?: unknown };

const draftPhotosOf = (raw: unknown): DraftPhoto[] => {
    const photos = (raw as { photos?: unknown } | null)?.photos;
    return Array.isArray(photos) ? (photos as DraftPhoto[]) : [];
};

// Private spaces only. New files go to the private bucket in the space's folder (images only,
// metadata stripped by savePrivateFile); a saved photo is kept only if this space has it now.
// Returns the photo list and the keys uploaded by this call, so a failed save can remove them.
async function resolveSpacePhotos(
    drafts: DraftPhoto[],
    spaceId: string,
    current: FileInfo[],
): Promise<{ ok: true; photos: FileInfo[]; uploaded: string[] } | { ok: false; uploaded: string[] }> {
    const uploaded: string[] = [];
    if (drafts.length > SPACE_PHOTOS_MAX) return { ok: false, uploaded };
    const currentByUrl = new Map(current.map((photo) => [photo.url, photo]));
    const photos: FileInfo[] = [];
    for (const draft of drafts) {
        if (isFile(draft.file)) {
            const saved = await savePrivateFile(draft.file as File, spacePhotoFolder(spaceId));
            const ref = PHOTO_TYPES.has(saved.contentType) ? spacePhotoRefFromKey(spaceId, saved.key) : null;
            if (!ref) {
                await removePrivateObject(saved.key);
                continue;
            }
            uploaded.push(saved.key);
            photos.push({ url: spacePhotoUrl(ref), fileName: ref.file, originalName: saved.originalName });
            continue;
        }
        const url = typeof draft.existingMediaUrl === "string" ? draft.existingMediaUrl : draft.url;
        const kept = typeof url === "string" ? currentByUrl.get(url) : undefined;
        if (kept && parseSpacePhotoUrl(kept.url)?.spaceId === spaceId) photos.push(kept);
    }
    return { ok: true, photos, uploaded };
}

const removeKeysQuietly = async (keys: string[]) => {
    for (const key of keys) {
        try {
            await removePrivateObject(key);
        } catch (error) {
            logFailure("removing a space photo", error);
        }
    }
};

const keyOfPhoto = (photo: FileInfo): string | null => {
    const ref = parseSpacePhotoUrl(photo.url);
    return ref ? spacePhotoKey(ref) : null;
};

const logFailure = (action: string, error: unknown) => {
    console.error(`${action} failed:`, error instanceof Error ? error.name : "unknown error");
};

const signedInDid = async (): Promise<string | undefined> => {
    try {
        return await getAuthenticatedUserDid();
    } catch {
        return undefined;
    }
};

export async function getMySpacesAction(): Promise<SpaceActionResult> {
    try {
        const did = await signedInDid();
        if (!did) return { success: false, message: NOT_SIGNED_IN };
        return { success: true, spaces: await listSpacesForOwner(did) };
    } catch (error) {
        logFailure("getMySpacesAction", error);
        return { success: false, message: "Could not load your spaces." };
    }
}

export async function createSpaceAction(raw: unknown): Promise<SpaceActionResult> {
    try {
        const actor = await getSpaceActor(await signedInDid());
        if (!actor) return { success: false, message: NOT_SIGNED_IN };
        if (!actor.canCreate) return { success: false, message: getRestrictedActionMessage("add a space") };

        const parsed = parseSpaceInput(raw);
        if (!parsed.ok) return { success: false, message: `Please check the form (${parsed.error}).` };

        const spaceId = newSpaceId();
        let photos: FileInfo[] = [];
        let uploaded: string[] = [];
        if (parsed.value.type === "private") {
            const resolved = await resolveSpacePhotos(draftPhotosOf(raw), spaceId, []);
            uploaded = resolved.uploaded;
            if (!resolved.ok) return { success: false, message: TOO_MANY_PHOTOS };
            photos = resolved.photos;
        }

        const created = await createSpaceForOwner(actor.did, parsed.value, parsed.pickedLngLat, { spaceId, photos });
        if (!created.ok) {
            await removeKeysQuietly(uploaded);
            return {
                success: false,
                message: `You can add up to ${SPACES_PER_PERSON_MAX} spaces. Delete one to add another.`,
            };
        }
        return { success: true, spaces: await listSpacesForOwner(actor.did) };
    } catch (error) {
        logFailure("createSpaceAction", error);
        return { success: false, message: "Could not save the space." };
    }
}

export async function updateSpaceAction(spaceId: string, raw: unknown): Promise<SpaceActionResult> {
    try {
        const did = await signedInDid();
        if (!did) return { success: false, message: NOT_SIGNED_IN };

        const parsed = parseSpaceInput(raw);
        if (!parsed.ok) return { success: false, message: `Please check the form (${parsed.error}).` };

        const id = String(spaceId);
        const current = await getSpacePhotosForOwner(did, id);
        if (!current) return { success: false, message: NOT_FOUND };
        let photos: FileInfo[] = [];
        let uploaded: string[] = [];
        if (parsed.value.type === "private") {
            const resolved = await resolveSpacePhotos(draftPhotosOf(raw), id, current);
            uploaded = resolved.uploaded;
            if (!resolved.ok) return { success: false, message: TOO_MANY_PHOTOS };
            photos = resolved.photos;
        }

        const updated = await updateSpaceForOwner(did, id, parsed.value, parsed.pickedLngLat, photos);
        if (!updated) {
            await removeKeysQuietly(uploaded);
            return { success: false, message: NOT_FOUND };
        }
        // Photos the owner took out: their files go too.
        const keptUrls = new Set(photos.map((photo) => photo.url));
        await removeKeysQuietly(
            current
                .filter((photo) => !keptUrls.has(photo.url))
                .map(keyOfPhoto)
                .filter((key): key is string => !!key),
        );
        return { success: true, spaces: await listSpacesForOwner(did) };
    } catch (error) {
        logFailure("updateSpaceAction", error);
        return { success: false, message: "Could not save the space." };
    }
}

export async function deleteSpaceAction(spaceId: string): Promise<SpaceActionResult> {
    try {
        const did = await signedInDid();
        if (!did) return { success: false, message: NOT_SIGNED_IN };

        const deleted = await deleteSpaceForOwner(did, String(spaceId));
        if (!deleted) return { success: false, message: NOT_FOUND };
        // The space's photo folder (only ever this space's own photos).
        try {
            if (/^[0-9a-f]{24}$/.test(String(spaceId))) {
                const keys = await listObjectKeysByPrefix("private", `${spacePhotoFolder(String(spaceId))}/`);
                await removeObjectKeys("private", keys);
            }
        } catch (error) {
            logFailure("removing a deleted space's photos", error);
        }
        return { success: true, spaces: await listSpacesForOwner(did) };
    } catch (error) {
        logFailure("deleteSpaceAction", error);
        return { success: false, message: "Could not delete the space." };
    }
}
