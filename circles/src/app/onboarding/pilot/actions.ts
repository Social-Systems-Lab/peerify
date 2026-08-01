"use server";

// Server actions for the post-email-verification pilot onboarding card sequence
// (src/components/onboarding/pilot/pilot-onboarding-flow.tsx). Each action writes directly
// to the real underlying circle field via the existing updateCircle() — there is no separate
// draft/staging store, matching the pattern already used by about-settings-form.tsx and
// updateCircleField (src/components/modules/home/actions.ts). Every action re-checks
// isAuthorized() itself, since updateCircle() only self-enforces ownership for
// circleType === "user" circles (see its own comment) — the auto-provisioned artist circle
// is not a user circle, so these actions are the authorization boundary for it.

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { features } from "@/lib/data/constants";
import { getCircleById, getPilotArtistCircleReadiness, updateCircle } from "@/lib/data/circle";
import { saveFile } from "@/lib/data/storage";
import { revalidatePath } from "next/cache";
import { Circle, FormSubmitResponse, Location, Media } from "@/models/models";
import type { ImageItem } from "@/components/forms/controls/multi-image-uploader";
import { normalizePeerifyArtistProfile, PEERIFY_ARTIST_IDENTITY_TYPES, PeerifyArtistIdentityType } from "@/lib/peerify/artist-profile";
import type { VerificationReadiness } from "@/lib/verification-readiness";

const authorizeEdit = async (circleId: string): Promise<{ userDid: string } | { error: FormSubmitResponse }> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { error: { success: false, message: "You need to be logged in to continue." } };
    }
    const authorized = await isAuthorized(userDid, circleId, features.settings.edit_about);
    if (!authorized) {
        return { error: { success: false, message: "You are not authorized to edit this profile." } };
    }
    return { userDid };
};

const clonePeerifyMetadata = (circle: Circle): { metadata: Record<string, unknown>; peerify: Record<string, unknown> } => {
    const metadata =
        circle.metadata && typeof circle.metadata === "object" && !Array.isArray(circle.metadata)
            ? { ...(circle.metadata as Record<string, unknown>) }
            : {};
    const peerify =
        metadata.peerify && typeof metadata.peerify === "object" && !Array.isArray(metadata.peerify)
            ? { ...(metadata.peerify as Record<string, unknown>) }
            : {};
    return { metadata, peerify };
};

const revalidateCircle = (circle: Circle) => {
    if (circle.handle) {
        revalidatePath(`/circles/${circle.handle}`);
        revalidatePath(`/circles/${circle.handle}/home`);
    }
    revalidatePath("/onboarding/pilot");
};

// Frame 1a / A3 — avatar + one cover/hero image. `images` follows the same
// new-file-vs-existing-media reconciliation about-settings-form.tsx's saveAbout() uses, scoped
// down to just this one field (that function also touches ~20 unrelated fields we don't have
// loaded here).
export async function savePilotPictureAction(
    circleId: string,
    picture: File | null,
    images: ImageItem[],
): Promise<FormSubmitResponse> {
    const auth = await authorizeEdit(circleId);
    if ("error" in auth) return auth.error;

    const existingCircle = await getCircleById(circleId);
    if (!existingCircle) {
        return { success: false, message: "Profile not found." };
    }

    const update: Partial<Circle> = { _id: circleId };

    if (picture) {
        update.picture = await saveFile(picture, "picture", circleId, true);
    }

    if (images.length > 0) {
        const finalMedia: Media[] = [];
        for (const item of images) {
            if (item.file) {
                const savedFileInfo = await saveFile(item.file, "image", circleId, true);
                finalMedia.push({ name: item.file.name, type: item.file.type, fileInfo: savedFileInfo });
            } else if (item.existingMediaUrl) {
                const existingMedia = existingCircle.images?.find((m) => m.fileInfo.url === item.existingMediaUrl);
                if (existingMedia) finalMedia.push(existingMedia);
            }
        }
        update.images = finalMedia;
    }

    await updateCircle(update, auth.userDid);
    revalidateCircle(existingCircle);
    return { success: true, message: "Photo saved." };
}

// Frame 1b / A3.5 — About text.
export async function savePilotAboutAction(circleId: string, description: string): Promise<FormSubmitResponse> {
    const auth = await authorizeEdit(circleId);
    if ("error" in auth) return auth.error;

    const existingCircle = await getCircleById(circleId);
    if (!existingCircle) {
        return { success: false, message: "Profile not found." };
    }

    await updateCircle({ _id: circleId, description: description.trim() }, auth.userDid);
    revalidateCircle(existingCircle);
    return { success: true, message: "About saved." };
}

// Frame 1c (personal, includes `searchable`) / A4 (artist, location only — artist circles
// default to public map visibility already, see getSwipeCircles()'s mapVisible gate, which
// only applies to circleType "user", so there is nothing to write for that here).
export async function savePilotLocationAction(
    circleId: string,
    location: Location,
    searchable?: boolean,
): Promise<FormSubmitResponse> {
    const auth = await authorizeEdit(circleId);
    if ("error" in auth) return auth.error;

    const existingCircle = await getCircleById(circleId);
    if (!existingCircle) {
        return { success: false, message: "Profile not found." };
    }

    const update: Partial<Circle> = { _id: circleId, location };
    if (searchable !== undefined) {
        update.searchable = searchable;
    }

    await updateCircle(update, auth.userDid);
    revalidateCircle(existingCircle);
    return { success: true, message: "Location saved." };
}

// Frame A2 — solo vs band. Sets metadata.peerify.identityType, which
// getPeerifyDefaultAvatarUrl()/getPeerifyIdentityAvatarUrl() already use to pick the right
// default avatar, and PEERIFY_MANAGED_IDENTITY_TYPE_LABELS already uses to label the circle
// elsewhere — no new field needed, this just sets an existing one that createPilotArtistCircle
// always defaults to "artist".
export async function saveArtistIdentityTypeAction(
    circleId: string,
    identityType: Extract<PeerifyArtistIdentityType, "artist" | "band">,
): Promise<FormSubmitResponse> {
    const auth = await authorizeEdit(circleId);
    if ("error" in auth) return auth.error;

    const existingCircle = await getCircleById(circleId);
    if (!existingCircle) {
        return { success: false, message: "Profile not found." };
    }

    if (!PEERIFY_ARTIST_IDENTITY_TYPES.includes(identityType)) {
        return { success: false, message: "Invalid artist type." };
    }

    const { metadata, peerify } = clonePeerifyMetadata(existingCircle);
    peerify.identityType = identityType;
    metadata.peerify = peerify;

    await updateCircle({ _id: circleId, metadata }, auth.userDid);
    revalidateCircle(existingCircle);
    return { success: true, message: "Saved." };
}

// Frame F2 (fan) / A5 (artist) — reuses the artist genre taxonomy
// (PRIMARY_GENRE_OPTIONS/PRIMARY_GENRE_MAX_SELECTIONS) for both. Mirrors saveAbout()'s
// dual-write for artist circles (top-level primaryGenres + metadata.peerify.artistProfile) so
// this stays consistent with what the Settings/About form already writes; for a fan's personal
// circle there is no artistProfile, so only the top-level field is set.
export async function savePrimaryGenresAction(
    circleId: string,
    genres: string[],
    genreOther?: string,
): Promise<FormSubmitResponse> {
    const auth = await authorizeEdit(circleId);
    if ("error" in auth) return auth.error;

    const existingCircle = await getCircleById(circleId);
    if (!existingCircle) {
        return { success: false, message: "Profile not found." };
    }

    const trimmedOther = genres.includes("Other") ? genreOther?.trim() || undefined : undefined;
    const update: Partial<Circle> = {
        _id: circleId,
        primaryGenres: genres.length > 0 ? genres : undefined,
        primaryGenreOther: trimmedOther,
    };

    if (existingCircle.circleType !== "user") {
        const { metadata, peerify } = clonePeerifyMetadata(existingCircle);
        const currentArtistProfile = normalizePeerifyArtistProfile(peerify.artistProfile);
        peerify.artistProfile = {
            ...currentArtistProfile,
            primaryGenres: genres,
            primaryGenreOther: trimmedOther,
        };
        metadata.peerify = peerify;
        update.metadata = metadata;
    }

    await updateCircle(update, auth.userDid);
    revalidateCircle(existingCircle);
    return { success: true, message: "Genres saved." };
}

// Frame F3 (fan) — always the caller's own personal circle. "Maybe later" is stored distinctly
// from "Not for me" so a future ~30-day-active check-in nudge (not built here) can target it.
export async function saveContributionInterestAction(value: "yes" | "maybe" | "no"): Promise<FormSubmitResponse> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to continue." };
    }

    const { getCircleByDid } = await import("@/lib/data/circle");
    const circle = await getCircleByDid(userDid);
    if (!circle) {
        return { success: false, message: "Profile not found." };
    }

    await updateCircle({ _id: circle._id, contributionInterest: value }, userDid);
    revalidateCircle(circle);
    return { success: true, message: "Saved." };
}

// Thin re-fetch wrapper so the client-side artist "ready" screen can refresh readiness after
// each save without a full page reload. Reuses getPilotArtistCircleReadiness() as-is.
export async function getPilotArtistReadinessAction(circleId: string): Promise<VerificationReadiness | null> {
    const circle = await getCircleById(circleId);
    if (!circle) return null;
    return getPilotArtistCircleReadiness(circle);
}
