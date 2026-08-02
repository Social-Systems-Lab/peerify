"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAtom } from "jotai";
import { userAtom, PILOT_ONBOARDING_COMPLETED_STORAGE_KEY } from "@/lib/data/atoms";
import { getUserPrivateAction } from "@/components/modules/home/actions";
import { Circle, Media, Track, UserPrivate } from "@/models/models";
import type { VerificationReadiness } from "@/lib/verification-readiness";
import {
    PEERIFY_DEFAULT_ARTIST_AVATAR_URL,
    PEERIFY_DEFAULT_BAND_AVATAR_URL,
    PeerifyArtistIdentityType,
} from "@/lib/peerify/artist-profile";
import { DEFAULT_HERO_IMAGE_URLS } from "@/lib/default-heroes";
import { OnboardingCardShell } from "./onboarding-card-shell";
import { PhotoStep } from "./frames/photo-step";
import { AboutStep } from "./frames/about-step";
import { LocationStep } from "./frames/location-step";
import { GuidelinesStep } from "./frames/guidelines-step";
import { RoleExplainerStep } from "./frames/role-explainer-step";
import { GenresStep } from "./frames/genres-step";
import { ContributionStep } from "./frames/fan/contribution-step";
import { OffersExplainerStep } from "./frames/fan/offers-explainer-step";
import { OffersStep } from "./frames/fan/offers-step";
import { FanDoneStep } from "./frames/fan/fan-done-step";
import { ArtistTypeStep } from "./frames/artist/artist-type-step";
import { SongsStep } from "./frames/artist/songs-step";
import { ArtistReadyStep } from "./frames/artist/artist-ready-step";

// Known stock avatars a fresh circle can carry before any real upload — createPilotArtistCircle
// always seeds the artist one, never the band one, regardless of the eventual A2 choice, so
// Frame A3 needs to treat both as "still a placeholder" rather than "already customized" when
// picking which default to display for the identity type just selected.
const ARTIST_STOCK_AVATAR_URLS = new Set([PEERIFY_DEFAULT_ARTIST_AVATAR_URL, PEERIFY_DEFAULT_BAND_AVATAR_URL]);

// createCircle() seeds every fresh circle's `images` with one of a small fixed set of stock
// hero photos (see getDefaultHeroImage) so profiles never render with a blank cover elsewhere
// in the app. That's the right fallback for an already-published profile, but showing it as a
// pre-populated "your cover image" in this onboarding step is confusing (people can't tell if
// it's already their photo) — so the upload box here should start empty until a real photo is
// uploaded. The stored default is left untouched in the database; this only affects what this
// step displays.
const stripStockCoverImages = (images?: Media[]): Media[] =>
    (images || []).filter((image) => !DEFAULT_HERO_IMAGE_URLS.includes(image.fileInfo.url as (typeof DEFAULT_HERO_IMAGE_URLS)[number]));

// Two independent, phase-labeled step counters (replaces one continuous "Step X of 10/12"
// counter that made both paths — especially the artist one — feel long from the very first
// frame, and misled anyone who might "Go to profile" early). Each phase resets its own
// numbering; the role-aware explainer between phases and the final completion screens are
// deliberately excluded from every array below (and get no stepLabel/progress at all — see
// `phaseInfo`) since they're checkpoints/endpoints, not steps within a phase.
//
// Frames 1a-1d — the shared "Personal profile" phase, 4 real steps.
const PERSONAL_STEPS = ["photo", "about", "location", "guidelines"] as const;
// Frames F2/F3(/F3-explainer/F3-expanded) — "Fan setup". F3-explainer and F3-offers only
// render on the F3 "yes" answer, so the shorter ("maybe"/"no") path finishes against this same
// 4-step denominator early rather than the counter shrinking after the fact — same convention
// the old single counter already used for the fan "yes" branch being the longest path.
const FAN_PHASE_STEPS = ["fan-genres", "fan-contribution", "fan-offers-explainer", "fan-offers"] as const;
// Frames A2-A5 — "Artist profile", 6 real steps (artist-ready is the completion screen, not
// counted here).
const ARTIST_PHASE_STEPS = [
    "artist-solo-band",
    "artist-photo",
    "artist-about",
    "artist-songs",
    "artist-location",
    "artist-genres",
] as const;

type StepName =
    | (typeof PERSONAL_STEPS)[number]
    | "explainer"
    | (typeof FAN_PHASE_STEPS)[number]
    | "fan-done"
    | (typeof ARTIST_PHASE_STEPS)[number]
    | "artist-ready";

type PilotOnboardingFlowProps = {
    personalCircle: UserPrivate;
    artistCircle: Circle | null;
    initialArtistReadiness: VerificationReadiness | null;
    initialArtistTracks: Track[];
    // Where the flow starts on this page load — "photo" (Frame 1a) by default, or
    // "artist-solo-band" (Frame A2) when page.tsx has determined the shared Personal profile
    // phase is already fully complete and an artist phase is still ahead. See page.tsx for the
    // exact readiness check; this component just trusts whatever it's given.
    initialStep?: "photo" | "artist-solo-band";
};

const getInitialArtistIdentityType = (circle: Circle | null): Extract<PeerifyArtistIdentityType, "artist" | "band"> => {
    const metadata = circle?.metadata as { peerify?: { identityType?: string } } | undefined;
    return metadata?.peerify?.identityType === "band" ? "band" : "artist";
};

export function PilotOnboardingFlow({
    personalCircle,
    artistCircle,
    initialArtistReadiness,
    initialArtistTracks,
    initialStep,
}: PilotOnboardingFlowProps) {
    const router = useRouter();
    const [, setUser] = useAtom(userAtom);
    const role: "fan" | "artist" = artistCircle ? "artist" : "fan";
    const [step, setStep] = useState<StepName>(initialStep ?? "photo");
    const [artistIdentityType, setArtistIdentityType] = useState(getInitialArtistIdentityType(artistCircle));

    // Which phase `step` currently belongs to, and that phase's own step count — null for the
    // explainer/completion screens, which render unnumbered (see stepLabel/progress below).
    const phaseInfo = useMemo(() => {
        if ((PERSONAL_STEPS as readonly string[]).includes(step)) {
            return { label: "Personal profile", steps: PERSONAL_STEPS as readonly string[] };
        }
        if ((FAN_PHASE_STEPS as readonly string[]).includes(step)) {
            return { label: "Fan setup", steps: FAN_PHASE_STEPS as readonly string[] };
        }
        if ((ARTIST_PHASE_STEPS as readonly string[]).includes(step)) {
            return { label: "Artist profile", steps: ARTIST_PHASE_STEPS as readonly string[] };
        }
        return null;
    }, [step]);

    // Whether the Back control should be interactive on the current frame — disabled (never
    // hidden) on the very first frame of a phase, per spec: Back must never fall through to
    // raw browser history, so the first frame of each phase is a dead end going backward.
    const canGoBack = Boolean(phaseInfo) && phaseInfo!.steps.indexOf(step) > 0;

    // Steps back exactly one frame within the current phase's own step array — never across a
    // phase boundary (canGoBack is false there) and never via router history.
    const goBack = () => {
        if (!phaseInfo) return;
        const index = phaseInfo.steps.indexOf(step);
        if (index > 0) setStep(phaseInfo.steps[index - 1] as StepName);
    };

    // userAtom (the header avatar, and — more importantly — every client-side "is my profile
    // complete" check: getParticipationState in community-feed.tsx/post-list.tsx, and
    // AboutPage's own "Complete profile" banner) is populated once at initial page load and
    // otherwise never refreshes itself. Without this, completing a field mid-flow (About,
    // location, genres, guidelines, ...) leaves those checks reading old data — e.g. showing
    // "Add About text" still unchecked in the participation-gate dialog right after actually
    // saving it. Real server-side authorization is unaffected either way (isAuthorized/
    // canPerformRestrictedAction always re-derive from a fresh DB read, never from this atom)
    // — this only fixes what the CLIENT displays and pre-emptively gates on.
    const refreshUser = async () => {
        const refreshedUser = await getUserPrivateAction();
        if (refreshedUser) setUser(refreshedUser);
    };

    // Every step writes straight to the real circle document as it goes (no draft store), but
    // this component only ever fetches personalCircle/artistCircle/initialArtistTracks ONCE, at
    // initial page load — so without this, going back to an earlier frame after saving later
    // ones would show stale (often blank) data instead of what was actually just saved.
    // router.refresh() re-runs the page's server component and pushes fresh props back down
    // (same technique SongsStep/TrackUploadForm already uses for its own track list), while
    // this component's own state (step, artistIdentityType) survives the refresh untouched.
    // Also refreshes userAtom (see refreshUser above) for the same reason, on every phase-scoped
    // step transition — centralized here rather than threaded through each frame's own onSaved,
    // since every real save already funnels through this one function.
    const advanceStep = (next: StepName) => {
        router.refresh();
        void refreshUser();
        setStep(next);
    };

    // See PILOT_ONBOARDING_COMPLETED_STORAGE_KEY's own comment (atoms.ts) — marks this
    // account as having already been through a tailored walkthrough, so HomeContent's
    // generic "Welcome to Peerify" popup (esp. its "are you an artist" pitch) doesn't show
    // again right after, on either the personal profile or a just-built artist circle.
    const markPilotOnboardingComplete = () => {
        try {
            window.localStorage.setItem(PILOT_ONBOARDING_COMPLETED_STORAGE_KEY, "1");
        } catch {
            // localStorage unavailable (private mode etc.) — non-critical, the dialog just
            // falls back to its existing suppression rules.
        }
    };

    const goToProfile = async () => {
        markPilotOnboardingComplete();
        await refreshUser();
        router.push(`/circles/${personalCircle.handle}/home`);
    };

    // undefined (not just omitted) for the explainer/completion screens — OnboardingCardShell
    // only renders the counter block when stepLabel/progress are actually provided, so these
    // render as plain unnumbered transition/checkpoint cards.
    const stepLabel = phaseInfo
        ? `${phaseInfo.label} — Step ${phaseInfo.steps.indexOf(step) + 1} of ${phaseInfo.steps.length}`
        : undefined;
    const progress = phaseInfo ? ((phaseInfo.steps.indexOf(step) + 1) / phaseInfo.steps.length) * 100 : undefined;

    if (step === "photo") {
        return (
            <OnboardingCardShell
                title="Add a photo"
                subtitle="A face helps people recognize you. You can always change this later."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <PhotoStep
                    circleId={String(personalCircle._id)}
                    initialPictureUrl={personalCircle.picture?.url}
                    initialImages={stripStockCoverImages(personalCircle.images)}
                    reassurance="Private by default, so a missing photo carries no risk. No hard requirement."
                    onContinue={() => advanceStep("about")}
                    onSkip={() => setStep("about")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "about") {
        return (
            <OnboardingCardShell
                title="A short About me"
                subtitle="Say a few words about yourself — a sentence or two is plenty."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <AboutStep
                    circleId={String(personalCircle._id)}
                    initialValue={personalCircle.description}
                    onContinue={() => advanceStep("location")}
                    onSkip={() => setStep("location")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "location") {
        return (
            <OnboardingCardShell
                title="Where are you based?"
                subtitle="You won't show up on the map — your location here just helps with things like distance and search."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <LocationStep
                    circleId={String(personalCircle._id)}
                    initialLocation={personalCircle.location}
                    showSearchToggle
                    initialSearchable={personalCircle.searchable ?? true}
                    onContinue={() => advanceStep("guidelines")}
                    onSkip={() => setStep("guidelines")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "guidelines") {
        return (
            <OnboardingCardShell
                title="Community Guidelines"
                subtitle="A quick read — this is what keeps Peerify feeling like a community, not a marketplace."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <GuidelinesStep onAccepted={() => advanceStep("explainer")} />
            </OnboardingCardShell>
        );
    }

    if (step === "explainer") {
        return (
            <OnboardingCardShell
                title={role === "fan" ? "Your profile is now active" : "Your personal profile is now active"}
                stepLabel={stepLabel}
                progress={progress}
            >
                <RoleExplainerStep
                    role={role}
                    onGoToProfile={goToProfile}
                    onContinueSetup={() => setStep(role === "fan" ? "fan-genres" : "artist-solo-band")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "fan-genres") {
        return (
            <OnboardingCardShell
                title="Pick a few genres"
                subtitle="Helps us surface artists you'll actually like."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <GenresStep
                    circleId={String(personalCircle._id)}
                    initialGenres={personalCircle.primaryGenres}
                    initialGenreOther={personalCircle.primaryGenreOther}
                    maxSelections={Infinity}
                    onContinue={() => advanceStep("fan-contribution")}
                    onSkip={() => setStep("fan-contribution")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "fan-contribution") {
        return (
            <OnboardingCardShell
                title="Want to help artists on tour?"
                subtitle="A spare room, a lift from the station, a hand with promotion — small things that make a huge difference. Totally optional, no pressure either way."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <ContributionStep
                    initialValue={personalCircle.contributionInterest}
                    onSelected={(value) => advanceStep(value === "yes" ? "fan-offers-explainer" : "fan-done")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "fan-offers-explainer") {
        return (
            <OnboardingCardShell
                title="How offers work"
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <OffersExplainerStep onContinue={() => setStep("fan-offers")} />
            </OnboardingCardShell>
        );
    }

    if (step === "fan-offers") {
        return (
            <OnboardingCardShell
                title="What could you offer?"
                subtitle="Pick as many as apply — you can add detail or change these anytime."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <OffersStep
                    circleId={String(personalCircle._id)}
                    circleHandle={personalCircle.handle || ""}
                    initialOfferings={personalCircle.tourTeamOfferings}
                    onContinue={() => advanceStep("fan-done")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "fan-done") {
        return (
            <OnboardingCardShell title="You're in" stepLabel={stepLabel} progress={progress}>
                <FanDoneStep
                    onExplore={() => {
                        markPilotOnboardingComplete();
                        router.push("/explore");
                    }}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "artist-solo-band" && artistCircle) {
        return (
            <OnboardingCardShell
                title="Welcome to your public artist profile setup"
                subtitle="This is different from your personal profile — it's what fans and hosts will see."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <ArtistTypeStep
                    circleId={String(artistCircle._id)}
                    initialType={artistIdentityType}
                    onSaved={(type) => {
                        setArtistIdentityType(type);
                        advanceStep("artist-photo");
                    }}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "artist-photo" && artistCircle) {
        const currentPictureUrl = artistCircle.picture?.url;
        const artistInitialPictureUrl =
            currentPictureUrl && !ARTIST_STOCK_AVATAR_URLS.has(currentPictureUrl)
                ? currentPictureUrl
                : artistIdentityType === "band"
                  ? PEERIFY_DEFAULT_BAND_AVATAR_URL
                  : PEERIFY_DEFAULT_ARTIST_AVATAR_URL;

        return (
            <OnboardingCardShell
                title="Add your artist photo"
                subtitle="This is what shows up on the map and in search — not your personal photo from before."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <PhotoStep
                    circleId={String(artistCircle._id)}
                    initialPictureUrl={artistInitialPictureUrl}
                    initialImages={stripStockCoverImages(artistCircle.images)}
                    onContinue={() => advanceStep("artist-about")}
                    onSkip={() => setStep("artist-about")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "artist-about" && artistCircle) {
        return (
            <OnboardingCardShell
                title="Add an introduction to your public artist profile"
                subtitle="A sentence or two — this is your public artist profile's own bio, separate from your personal profile, and fans will see it here."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <AboutStep
                    circleId={String(artistCircle._id)}
                    initialValue={artistCircle.description}
                    placeholder="Tell fans a little about the music"
                    onContinue={() => advanceStep("artist-songs")}
                    onSkip={() => setStep("artist-songs")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "artist-songs" && artistCircle) {
        return (
            <OnboardingCardShell
                title="Add a few songs"
                subtitle="Add up to three — this is what most fans will hear first. You can add more later from the Music tab."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <SongsStep
                    circleId={String(artistCircle._id)}
                    tracks={initialArtistTracks}
                    onContinue={() => advanceStep("artist-location")}
                    onSkip={() => setStep("artist-location")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "artist-location" && artistCircle) {
        return (
            <OnboardingCardShell
                title="Where can fans find you?"
                subtitle="Your artist profile shows up on the public map by default — that's how fans find you. You can change this in Settings later if needed."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <LocationStep
                    circleId={String(artistCircle._id)}
                    initialLocation={artistCircle.location}
                    showSearchToggle={false}
                    onContinue={() => advanceStep("artist-genres")}
                    onSkip={() => setStep("artist-genres")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "artist-genres" && artistCircle) {
        return (
            <OnboardingCardShell
                title="What genres describe your sound?"
                subtitle="Optional — helps with future matchmaking."
                stepLabel={stepLabel}
                progress={progress}
                onBack={goBack}
                canGoBack={canGoBack}
            >
                <GenresStep
                    circleId={String(artistCircle._id)}
                    initialGenres={artistCircle.primaryGenres}
                    initialGenreOther={artistCircle.primaryGenreOther}
                    onContinue={() => advanceStep("artist-ready")}
                    onSkip={() => setStep("artist-ready")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "artist-ready" && artistCircle && initialArtistReadiness) {
        const goToArtistProfile = () => {
            markPilotOnboardingComplete();
            router.push(`/circles/${artistCircle.handle}`);
        };

        return (
            <OnboardingCardShell
                title="Your artist profile is set up"
                subtitle="You can publish now, or add more information first."
                stepLabel={stepLabel}
                progress={progress}
            >
                <ArtistReadyStep
                    circleId={String(artistCircle._id)}
                    initialReadiness={initialArtistReadiness}
                    onGoToProfile={goToArtistProfile}
                    onPublished={goToArtistProfile}
                />
            </OnboardingCardShell>
        );
    }

    return null;
}
