"use server";

// "Change cover" on a profile/circle header (HomeCover). Same permission as Settings → About
// (edit_about), checked here on the server, and the same upload path: saveFile runs every image
// through sanitizeUpload, which strips EXIF/GPS and other metadata. The new image replaces the
// first uploaded cover and the rest of the carousel is kept; adding, removing and reordering
// covers stays in Settings → About.

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { getCircleById, getCirclePath, updateCircle } from "@/lib/data/circle";
import { features } from "@/lib/data/constants";
import { deleteUploadedFiles, getCircleFileUrls, saveFile } from "@/lib/data/storage";
import { getCustomCoverImages } from "@/lib/default-heroes";
import { getImageUploadRejection } from "@/lib/image-upload-limits";
import { getImageUploadErrorMessage } from "@/lib/media/sanitize-image";
import { Media } from "@/models/models";
import { revalidatePath } from "next/cache";

type CoverActionResponse = {
    success: boolean;
    message: string;
};

export const updateCircleCoverAction = async (circleId: string, formData: FormData): Promise<CoverActionResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to change the cover" };
    }

    try {
        const authorized = await isAuthorized(userDid, circleId, features.settings.edit_about);
        if (!authorized) {
            return { success: false, message: "You are not authorized to change this cover" };
        }

        const file = formData.get("cover");
        if (!(file instanceof File) || file.size === 0) {
            return { success: false, message: "Please choose an image to upload." };
        }
        const rejection = getImageUploadRejection(file);
        if (rejection) {
            return { success: false, message: rejection };
        }

        const circle = await getCircleById(circleId);
        if (!circle) {
            return { success: false, message: "Circle not found" };
        }

        let fileInfo;
        try {
            fileInfo = await saveFile(file, "image", circleId, true);
        } catch (uploadError) {
            console.error("Failed to upload cover:", uploadError);
            return { success: false, message: getImageUploadErrorMessage(uploadError) };
        }

        // Stock/default covers are never kept as uploads (see getCustomCoverImages)
        const [replaced, ...rest] = getCustomCoverImages(circle.images);
        const images: Media[] = [{ name: file.name, type: file.type, fileInfo }, ...rest];

        try {
            await updateCircle({ _id: circleId, images }, userDid);
        } catch (saveError) {
            await deleteUploadedFiles([fileInfo.url], getCircleFileUrls(circle));
            throw saveError;
        }

        // The old cover is deleted only once the circle no longer points at it
        if (replaced?.fileInfo?.url) {
            await deleteUploadedFiles([replaced.fileInfo.url], getCircleFileUrls({ picture: circle.picture, images }));
        }

        const circlePath = await getCirclePath(circle);
        revalidatePath(circlePath);
        revalidatePath(`${circlePath}settings/about`);

        return { success: true, message: "Cover updated" };
    } catch (error) {
        console.error("Failed to update cover:", error);
        return { success: false, message: "The cover couldn't be updated. Please try again." };
    }
};
