"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { getCircleById, isPilotArtistCircleReadyToPublish, updateCircle } from "@/lib/data/circle";
import { features } from "@/lib/data/constants";
import { getPeerifyMetadata, isPeerifyManagedIdentity } from "@/lib/peerify/artist-profile";

type PublishManagedPeerifyIdentityResult = {
    success: boolean;
    message: string;
};

export async function publishManagedPeerifyIdentityAction(circleId: string): Promise<PublishManagedPeerifyIdentityResult> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to publish this profile." };
    }

    const circle = await getCircleById(circleId);
    if (!circle?._id) {
        return { success: false, message: "Profile not found." };
    }

    if (!isPeerifyManagedIdentity(circle)) {
        return { success: false, message: "Only managed Peerify profiles can be published here." };
    }

    const authorized = await isAuthorized(userDid, circle._id, features.settings.edit_about);
    if (!authorized) {
        return { success: false, message: "You are not authorized to publish this profile." };
    }

    if (circle.publishStatus === "published") {
        return { success: true, message: "Profile is already published." };
    }

    // Pilot-signup-provisioned artist circles require isPilotArtistCircleReadyToPublish
    // (src/lib/data/circle.ts) before this manual button can publish them, or it would let a
    // freshly auto-provisioned circle (default avatar, no About text, no location, guidelines
    // unsigned) publish with zero edits. Re-validated here server-side regardless of the
    // button's client-side disabled state. Manually-created (CircleWizard) managed identities
    // are untouched — they've never had a completion gate on this button.
    if (getPeerifyMetadata(circle).autoProvisionedFromSignup === true) {
        const ready = await isPilotArtistCircleReadyToPublish(circle);
        if (!ready) {
            return {
                success: false,
                message:
                    "Complete this profile's picture, About text, and map location, and sign the Community Guidelines on your personal profile, before publishing.",
            };
        }
    }

    await updateCircle({ _id: circle._id, publishStatus: "published" }, userDid);

    revalidatePath("/profiles");
    if (circle.handle) {
        revalidatePath(`/circles/${circle.handle}`);
        revalidatePath(`/circles/${circle.handle}/home`);
        revalidatePath(`/circles/${circle.handle}/settings/about`);
    }

    return { success: true, message: "Profile published." };
}
