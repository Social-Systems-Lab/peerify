// Peerify: server action for song "ovation" (clap) taps. Phase 2a — visual/tap
// feedback only. No notifications yet (deferred to Phase 2b until real clap
// volume is observed) and no count is ever returned to the tapping fan — the
// tap animation is the only feedback, per the locked no-public-numbers decision.
"use server";

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { features } from "@/lib/data/constants";
import { getTrackById, hasUserOvatedTrack, ovateTrack } from "@/lib/data/track";

export async function ovateTrackAction(trackId: string): Promise<{ success: boolean; message?: string }> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to give an ovation" };
    }

    try {
        const track = await getTrackById(trackId);
        if (!track) {
            return { success: false, message: "Song not found" };
        }

        const authorized = await isAuthorized(userDid, track.artistProfileId, features.music.react);
        if (!authorized) {
            return { success: false, message: "You are not authorized to react to this song" };
        }

        await ovateTrack(trackId, userDid);
        return { success: true };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Failed to give ovation." };
    }
}

// Restores OvateButton's persistent active/enlarged look on mount for a fan who
// has ovated this track before. Scoped strictly to the caller's own
// authenticated did (never a client-supplied identity) and never returns a
// count — only whether they personally have ovated at least once.
export async function getHasOvatedTrackAction(
    trackId: string,
): Promise<{ success: boolean; hasOvated?: boolean; message?: string }> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: true, hasOvated: false };
    }

    try {
        const track = await getTrackById(trackId);
        if (!track) {
            return { success: false, message: "Song not found" };
        }

        const hasOvated = await hasUserOvatedTrack(trackId, userDid);
        return { success: true, hasOvated };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Failed to check ovation status." };
    }
}
