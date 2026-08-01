import { redirect } from "next/navigation";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getUserPrivate } from "@/lib/data/user";
import { getAutoProvisionedArtistCircle, getPilotArtistCircleReadiness } from "@/lib/data/circle";
import { PilotOnboardingFlow } from "@/components/onboarding/pilot/pilot-onboarding-flow";

// Entry point for the guided, card-based onboarding sequence shown immediately after email
// verification for NEW pilot signups only (see the fresh-verification branch of
// verifyEmailAction, src/app/(auth)/verify-email/actions.ts, which is the only thing that
// links here). Existing accounts with incomplete profiles are never routed here — they keep
// seeing the settings-page banners/checklists from prior sessions.
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
    const artistReadiness = artistCircle ? await getPilotArtistCircleReadiness(artistCircle) : null;

    return (
        <PilotOnboardingFlow
            personalCircle={personalCircle}
            artistCircle={artistCircle}
            initialArtistReadiness={artistReadiness}
        />
    );
}
