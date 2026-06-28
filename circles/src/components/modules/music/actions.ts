"use server";

import { randomBytes } from "crypto";
import path from "path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { features } from "@/lib/data/constants";
import { getCircleById } from "@/lib/data/circle";
import { putPrivateObject } from "@/lib/data/storage";
import { createTrack, getTracksByCircleId, getTrackById, deleteTrack } from "@/lib/data/track";
import { generateMp3Preview } from "@/lib/audio/ffmpeg";

// Accepted upload formats → canonical mime used when storing the original.
const ACCEPTED_EXTENSIONS: Record<string, string> = {
    ".mp3": "audio/mpeg",
};

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_TRACKS_PER_ARTIST = 3;

const uploadSchema = z.object({
    title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
    circleId: z.string().min(1, "Missing artist profile"),
    rightsConfirmed: z.literal(true, {
        errorMap: () => ({ message: "You must confirm you own or control the rights to this audio" }),
    }),
});

export type UploadTrackResult = { success: boolean; message?: string; trackId?: string };

export async function uploadTrackAction(formData: FormData): Promise<UploadTrackResult> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in" };
    }

    try {
        const parsed = uploadSchema.safeParse({
            title: formData.get("title"),
            circleId: formData.get("circleId"),
            rightsConfirmed: formData.get("rightsConfirmed") === "true",
        });
        if (!parsed.success) {
            return { success: false, message: parsed.error.errors.map((e) => e.message).join(", ") };
        }
        const { title, circleId } = parsed.data;

        const file = formData.get("audio");
        if (!(file instanceof File) || file.size === 0) {
            return { success: false, message: "Please choose an audio file" };
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            return { success: false, message: "File is too large (max 20MB)" };
        }

        const ext = path.extname(file.name).toLowerCase();
        const originalMimeType = ACCEPTED_EXTENSIONS[ext];
        if (!originalMimeType) {
            return { success: false, message: "Unsupported format. MP3 only for now." };
        }

        // Defense-in-depth: the browser-reported type should also be MP3.
        if (file.type && file.type !== "audio/mpeg" && file.type !== "audio/mp3") {
            return { success: false, message: "Unsupported format. MP3 only for now." };
        }

        // Must own/administer this artist profile (same check the profile editor uses).
        const circle = await getCircleById(circleId);
        if (!circle) {
            return { success: false, message: "Artist profile not found" };
        }
        const authorized = await isAuthorized(userDid, circleId, features.settings.edit_about);
        if (!authorized) {
            return { success: false, message: "You are not authorized to upload tracks to this profile" };
        }

        // Enforce the per-artist track cap (pilot limit).
        const existingTracks = await getTracksByCircleId(circleId);
        if (existingTracks.length >= MAX_TRACKS_PER_ARTIST) {
            return {
                success: false,
                message: `You can have up to ${MAX_TRACKS_PER_ARTIST} tracks. Delete one to upload another.`,
            };
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // Random key id keeps the storage keys non-enumerable.
        const keyId = randomBytes(12).toString("hex");
        const originalKey = `audio/${circleId}/${keyId}/original${ext}`;
        const previewKey = `audio/${circleId}/${keyId}/preview.mp3`;

        // 1) Store the original (private, never served directly).
        await putPrivateObject(originalKey, buffer, originalMimeType);

        // 2) Generate ONE web-playable MP3 derivative and store it (private too).
        let durationSec: number | undefined;
        try {
            const derivative = await generateMp3Preview(buffer, ext);
            durationSec = derivative.durationSec;
            await putPrivateObject(previewKey, derivative.buffer, "audio/mpeg");
        } catch (err) {
            console.error("Error generating MP3 derivative:", err);
            return {
                success: false,
                message: "Could not process the audio (ffmpeg). The original was not published.",
            };
        }

        // 3) Record the Track, including rights consent.
        const now = new Date();
        const track = await createTrack({
            artistProfileId: circleId,
            title,
            originalKey,
            previewKey,
            durationSec,
            originalMimeType,
            rightsConfirmed: true,
            rightsConfirmedAt: now,
            createdAt: now,
            createdBy: userDid,
        });

        if (circle.handle) {
            revalidatePath(`/circles/${circle.handle}/music`);
        }

        return { success: true, message: "Track uploaded", trackId: track._id?.toString() };
    } catch (error) {
        console.error("Error uploading track:", error);
        return { success: false, message: "Failed to upload track" };
    }
}

export async function deleteTrackAction(trackId: string): Promise<{ success: boolean; message?: string }> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in" };
    }

    try {
        const track = await getTrackById(trackId);
        if (!track) {
            return { success: false, message: "Track not found" };
        }

        const circleId = track.artistProfileId;
        const authorized = await isAuthorized(userDid, circleId, features.settings.edit_about);
        if (!authorized) {
            return { success: false, message: "You are not authorized to delete this track" };
        }

        // deleteTrack removes both private storage objects (explicit keys, no
        // wildcards) and the Track document.
        await deleteTrack(trackId);

        const circle = await getCircleById(circleId);
        if (circle?.handle) {
            revalidatePath(`/circles/${circle.handle}/music`);
        }

        return { success: true };
    } catch (error) {
        console.error("Error deleting track:", error);
        return { success: false, message: "Failed to delete track" };
    }
}
