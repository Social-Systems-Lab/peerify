"use server";

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { getCircleById, getCirclePath, updateCircle } from "@/lib/data/circle";
import { features } from "@/lib/data/constants";
import { isFile, saveFile } from "@/lib/data/storage";
import { Circle, FileInfo, FormSubmitResponse, TourTeamOffering } from "@/models/models";
import { revalidatePath } from "next/cache";
import sharp from "sharp";

// An offering's `photos` arrives from CreateOfferModal as MultiImageUploader's draft ImageItem
// shape ({id, file?, preview, existingMediaUrl?}), not the persisted fileInfoSchema[] — mirrors
// how saveAbout() (settings/about/actions.ts) resolves Circle.images at submit time, rather than
// uploading on every photo pick inside the modal. Any item missing both a new file and a resolvable
// existing url is dropped rather than persisting a broken photo entry.
//
// A real persisted photo URL is always a server path (/storage/... or /uploads/...), never a
// blob: URL — those are ephemeral, page-session-scoped object URLs from URL.createObjectURL(),
// meaningless once the page unloads. One can end up here if an offering's still-unresolved draft
// photo (added via the modal but never yet through a real page save) gets re-flattened into an
// "existing" entry by further picker interaction before its first real save — see
// create-offer-modal.tsx's isResolvedOfferPhoto for the client-side half of this. Reject rather
// than silently writing a dead URL into Mongo.
function isPersistableUrl(url: string): boolean {
    return !url.startsWith("blob:");
}

// Strips EXIF/ICC/XMP metadata (GPS location chief among them) before a new offer photo ever
// reaches saveFile/MinIO. Scoped here rather than inside saveFile() itself — saveFile is shared
// by ~15 other upload paths (chat, feeds, events, about-settings, etc.) with no privacy need for
// this, so stripping there would be a much bigger blast radius than this feature needs.
// .rotate() with no args must run before the strip: sharp drops metadata by default when no
// output format's own metadata-preserving option is requested, but EXIF orientation is itself
// metadata — dropping it without first baking the rotation into the pixel data would leave
// photos taken on their side rendering sideways everywhere. Falls back to the original file on
// any processing error (e.g. an exotic format sharp can't decode) rather than blocking the save.
async function stripPhotoMetadata(file: File): Promise<File> {
    try {
        const inputBuffer = Buffer.from(await file.arrayBuffer());
        const strippedBuffer = await sharp(inputBuffer).rotate().toBuffer();
        return new File([strippedBuffer], file.name, { type: file.type });
    } catch (error) {
        console.error("Error stripping EXIF metadata from offer photo, saving original:", error);
        return file;
    }
}

async function resolveOfferingPhotos(offering: TourTeamOffering, circleId: string): Promise<TourTeamOffering> {
    const draftPhotos = offering.photos as unknown as
        | Array<{ file?: File; url?: string; fileName?: string; originalName?: string; existingMediaUrl?: string }>
        | undefined;
    if (!draftPhotos || draftPhotos.length === 0) {
        return offering;
    }

    const resolvedPhotos: FileInfo[] = [];
    for (const photo of draftPhotos) {
        if (isFile(photo.file)) {
            const strippedFile = await stripPhotoMetadata(photo.file as File);
            resolvedPhotos.push(await saveFile(strippedFile, "offer-photo", circleId, true));
        } else if (typeof photo.existingMediaUrl === "string" && isPersistableUrl(photo.existingMediaUrl)) {
            resolvedPhotos.push({ url: photo.existingMediaUrl });
        } else if (typeof photo.url === "string" && isPersistableUrl(photo.url)) {
            // Already a resolved FileInfo — e.g. every offering in the array other than the one
            // just added/edited, which arrives here as-saved, not as an ImageItem draft. Pass it
            // through unchanged rather than reconstructing {url} and dropping fileName/originalName.
            resolvedPhotos.push({ url: photo.url, fileName: photo.fileName, originalName: photo.originalName });
        }
        // Anything else — including a real File that failed isFile(), or a blob: URL rejected by
        // isPersistableUrl() below — is dropped rather than persisting a broken photo entry.
    }
    return { ...offering, photos: resolvedPhotos };
}

export async function savePresence(data: Circle): Promise<FormSubmitResponse> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) {
            throw new Error("User not authenticated");
        }

        const engagementInterests = data.engagements?.interests;
        const engagementSettings: Circle["engagements"] = data.engagements
            ? { ...data.engagements }
            : undefined;

        if (engagementSettings) {
            delete engagementSettings.interests;
        }

        const resolvedOfferings = data.tourTeamOfferings
            ? await Promise.all(data.tourTeamOfferings.map((offering) => resolveOfferingPhotos(offering, data._id as string)))
            : data.tourTeamOfferings;

        // offersVisible is deliberately NOT included here — it auto-saves on click via its own
        // dedicated action (setOffersVisibleAction below), the same reasoning as crewEnabled
        // being kept out of saveAbout()'s whitelist: submitting this form must never silently
        // reset it back to a stale form-default value.
        await updateCircle(
            {
                _id: data._id,
                interests: engagementInterests,
                offers: data.offers,
                engagements: engagementSettings,
                needs: data.needs,
                tourTeamOfferings: resolvedOfferings,
            },
            userDid,
        );

        revalidatePath(`/circles/${data.handle}/settings/presence`);
        revalidatePath(`/circles/${data.handle}/home`);
        revalidatePath(`/circles/${data.handle}`);

        // Returned so the client can push the server-resolved shape (real FileInfo photos, not
        // the pre-save ImageItem drafts) back into the form via form.setValue — this form never
        // calls form.reset() after a save (only router.refresh(), which doesn't touch an
        // already-mounted react-hook-form instance's field values), so without this, editing the
        // same offering again later in the same page session would seed the offer photo picker
        // from stale draft objects instead of real, resolvable URLs.
        return {
            success: true,
            message: "Presence settings updated successfully",
            data: { tourTeamOfferings: resolvedOfferings },
        };
    } catch (error) {
        console.error("Error saving presence settings:", error);
        return {
            success: false,
            message: "Failed to update presence settings",
        };
    }
}

// Deliberately its own action rather than a field on savePresence() — the offers-map-visibility
// toggle auto-saves on click (see the OffersVisibleToggle component in presence-settings-form.tsx),
// so it must not be bundled into the same form state as the offerings editor/needs/engagements,
// which only save when the shared Save Changes button is clicked. Mirrors setCrewEnabledAction
// (settings/about/actions.ts) exactly.
export async function setOffersVisibleAction(circleId: string, offersVisible: boolean): Promise<FormSubmitResponse> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to edit circle settings" };
    }

    const authorized = await isAuthorized(userDid, circleId, features.settings.edit_about);
    if (!authorized) {
        return { success: false, message: "You are not authorized to edit circle settings" };
    }

    try {
        await updateCircle({ _id: circleId, offersVisible }, userDid);
    } catch (error) {
        return { success: false, message: "Failed to update offers visibility. " + error?.toString() };
    }

    const circle = await getCircleById(circleId);
    const circlePath = circle ? await getCirclePath(circle) : null;
    if (circlePath) {
        revalidatePath(circlePath);
        revalidatePath(`${circlePath}settings/presence`);
    }

    return { success: true };
}
