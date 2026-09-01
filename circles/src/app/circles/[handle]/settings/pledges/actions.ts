"use server";

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { getCircleByDid, getCircleById } from "@/lib/data/circle";
import { features } from "@/lib/data/constants";
import { deletePeerifyPledgeById, getPeerifyPledgeById } from "@/lib/data/peerify-pledges";

// Deliberately narrow: this only ever removes a pledge whose pledger account is verified gone
// at the moment of the call (re-checked here, never trusted from the client) — not a general
// "delete any pledge" capability. See the Pledge Dashboard's orphaned-pledge investigation.
export async function removeOrphanedPledgeAction(pledgeId: string): Promise<{ success: boolean; message?: string }> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in." };
    }

    if (!pledgeId) {
        return { success: false, message: "Missing pledge id." };
    }

    const pledge = await getPeerifyPledgeById(pledgeId);
    if (!pledge) {
        return { success: false, message: "Pledge not found." };
    }

    const artist = await getCircleById(pledge.artistCircleId);
    if (!artist?._id) {
        return { success: false, message: "Artist profile not found." };
    }

    const canManage = await isAuthorized(userDid, artist._id, features.settings.edit_about);
    if (!canManage) {
        return { success: false, message: "You're not authorized to manage this artist's pledges." };
    }

    const pledgerStillExists = await getCircleByDid(pledge.pledgerDid);
    if (pledgerStillExists) {
        return { success: false, message: "This pledger's account still exists — it can't be removed." };
    }

    const removed = await deletePeerifyPledgeById(pledgeId, pledge.artistCircleId);
    if (!removed) {
        return { success: false, message: "Failed to remove pledge." };
    }

    return { success: true };
}
