"use server";

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { features } from "@/lib/data/constants";
import { getCircleByDid, getCircleById } from "@/lib/data/circle";
import { createPeerifyPledge, getPeerifyPledgeForFan, type PeerifyPledgeRecord } from "@/lib/data/peerify-pledges";
import {
    isPeerifyArtistIdentity,
    isPeerifyManagedIdentity,
    type PeerifyPledgeEnquiryInput,
} from "@/lib/peerify/artist-profile";

export async function createPeerifyPledgeAction({
    artistCircleId,
    pledge,
}: {
    artistCircleId: string;
    pledge: PeerifyPledgeEnquiryInput;
}): Promise<{ success: boolean; message?: string; pledgeId?: string }> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to pledge interest" };
    }

    if (!artistCircleId) {
        return { success: false, message: "Missing artist profile" };
    }

    const artist = await getCircleById(artistCircleId);
    if (!artist?._id) {
        return { success: false, message: "Artist profile not found" };
    }

    if (!isPeerifyArtistIdentity(artist) || !isPeerifyManagedIdentity(artist)) {
        return { success: false, message: "This profile is not accepting structured pledges yet" };
    }

    // Same check the Pledge Interest button's own visibility is gated on (see home-content.tsx's
    // authorizedToEdit) — enforced here too, not just via the hidden button, so a direct call
    // can't have this artist's own admin pledge to themselves and pollute their Pledge Dashboard.
    const isArtistAdmin = await isAuthorized(userDid, artist._id, features.settings.edit_about);
    if (isArtistAdmin) {
        return { success: false, message: "You manage this profile, so you can't pledge to it yourself." };
    }

    const pledger = await getCircleByDid(userDid);
    if (!pledger?._id || !pledger.did) {
        return { success: false, message: "Could not resolve your profile" };
    }

    if (!pledge?.fanLocation?.trim() && !pledge?.note?.trim()) {
        return { success: false, message: "Add at least your location or a note before pledging." };
    }

    const record = await createPeerifyPledge({ artist, pledger, pledge });

    return {
        success: true,
        pledgeId: record._id,
        message: "Thanks — your pledge has been added to this artist's support map.",
    };
}

// Lets the Pledge dialog pre-fill from the fan's own existing pledge for this artist (if any) so
// resubmitting edits it in place instead of looking like a blank new pledge — the identity check
// mirrors createPeerifyPledgeAction's, since only managed-identity artists persist a re-editable
// structured pledge at all (the chat-enquiry fallback path for other circles never did). Resolves
// the viewer's did from the auth cookie, never a client-supplied value.
export async function getMyPeerifyPledgeAction(
    artistCircleId: string,
): Promise<{ pledge: PeerifyPledgeRecord | null }> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid || !artistCircleId) {
        return { pledge: null };
    }

    const artist = await getCircleById(artistCircleId);
    if (!artist?._id || !isPeerifyArtistIdentity(artist) || !isPeerifyManagedIdentity(artist)) {
        return { pledge: null };
    }

    const pledge = await getPeerifyPledgeForFan(artistCircleId, userDid);
    return { pledge };
}
