import { redirect } from "next/navigation";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getUserPrivate } from "@/lib/data/user";
import { getAutoProvisionedArtistCircle, getPilotArtistCircleReadiness } from "@/lib/data/circle";
import { getTracksByCircleId } from "@/lib/data/track";
import { isPilotPersonalPhaseComplete } from "@/lib/verification-readiness";
import { PilotOnboardingFlow } from "@/components/onboarding/pilot/pilot-onboarding-flow";

// Entry point for the guided, card-based onboarding sequence — originally shown immediately
// after email verification for new pilot signups (see the fresh-verification branch of
// verifyEmailAction, src/app/(auth)/verify-email/actions.ts), and now also the target of every
// "Complete profile" link/button app-wide (community-participation-banner.tsx,
// community-participation-dialog.tsx, home-content.tsx's artist-circle draft banner) — it works
// for any authenticated account regardless of signup path, since it only ever reads the
// CURRENTLY LOGGED IN user's own circle state. Existing accounts with incomplete profiles still
// also see the settings-page banners/checklists from prior sessions; that's untouched, this is
// just an additional, better path back into completion.
export default async function PilotOnboardingPage() {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        redirect("/login?redirectTo=%2Fonboarding%2Fpilot");
    }

    const personalCircle = await getUserPrivate(userDid);
    if (!personalCircle) {
        redirect("/login?redirectTo=%2Fonboarding%2Fpilot");
    }

    const artistCircle = await getAutoProvisionedArtistCircle(userDid);
    const [artistReadiness, artistTracks] = await Promise.all([
        artistCircle ? getPilotArtistCircleReadiness(artistCircle) : Promise.resolve(null),
        artistCircle?._id ? getTracksByCircleId(String(artistCircle._id)) : Promise.resolve([]),
    ]);

    // Resuming always restarts at Frame 1a by default (confirmed acceptable — full
    // "resume at first incomplete step" logic is explicitly not required). The one nice-to-have
    // exception: if the shared Personal profile phase (photo/about/location/guidelines — the
    // same four fields/gesture Frames 1a-1d write) is already fully done and there's an artist
    // phase still ahead, skip straight to its first frame (A2) instead of re-clicking through
    // four already-complete shared frames again. isPilotPersonalPhaseComplete is the single
    // shared check for this — every entry point that can land here (the Home-tab "Complete
    // profile" banner, the posting-gate dialog, and the artist Draft-profile banner's "Continue
    // setup") just links to this same plain /onboarding/pilot URL, so they all get this same
    // server-computed jump decision automatically; there is no separate per-entry-point logic
    // to keep in sync.
    const initialStep = artistCircle && isPilotPersonalPhaseComplete(personalCircle) ? "artist-solo-band" : "photo";

    return (
        <PilotOnboardingFlow
            personalCircle={personalCircle}
            artistCircle={artistCircle}
            initialArtistReadiness={artistReadiness}
            initialArtistTracks={artistTracks}
            initialStep={initialStep}
        />
    );
}
