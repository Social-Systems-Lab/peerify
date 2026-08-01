"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { getUserPrivateAction } from "@/components/modules/home/actions";
import { Circle, Track, UserPrivate } from "@/models/models";
import type { VerificationReadiness } from "@/lib/verification-readiness";
import {
    PEERIFY_DEFAULT_ARTIST_AVATAR_URL,
    PEERIFY_DEFAULT_BAND_AVATAR_URL,
    PeerifyArtistIdentityType,
} from "@/lib/peerify/artist-profile";
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

// Step names across both paths, used only to size the progress bar — the fan "yes" branch is
// the longest, so it's the denominator; other branches just finish early against it.
const SHARED_STEPS = ["photo", "about", "location", "guidelines", "explainer"] as const;
const FAN_STEPS = [
    ...SHARED_STEPS,
    "fan-genres",
    "fan-contribution",
    "fan-offers-explainer",
    "fan-offers",
    "fan-done",
] as const;
const ARTIST_STEPS = [
    ...SHARED_STEPS,
    "artist-solo-band",
    "artist-photo",
    "artist-about",
    "artist-songs",
    "artist-location",
    "artist-genres",
    "artist-ready",
] as const;

type StepName = (typeof FAN_STEPS)[number] | (typeof ARTIST_STEPS)[number];

type PilotOnboardingFlowProps = {
    personalCircle: UserPrivate;
    artistCircle: Circle | null;
    initialArtistReadiness: VerificationReadiness | null;
    initialArtistTracks: Track[];
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
}: PilotOnboardingFlowProps) {
    const router = useRouter();
    const [, setUser] = useAtom(userAtom);
    const role: "fan" | "artist" = artistCircle ? "artist" : "fan";
    const [step, setStep] = useState<StepName>("photo");
    const [artistIdentityType, setArtistIdentityType] = useState(getInitialArtistIdentityType(artistCircle));

    const orderedSteps = role === "fan" ? FAN_STEPS : ARTIST_STEPS;
    const progress = useMemo(() => {
        const index = (orderedSteps as readonly string[]).indexOf(step);
        return ((index + 1) / orderedSteps.length) * 100;
    }, [orderedSteps, step]);

    // The header/profile-switcher avatar reads from `userAtom`, which is only populated once
    // at initial page load — it doesn't know a picture saved mid-flow via savePilotPictureAction
    // changed anything server-side (that write goes straight to the Circle document, bypassing
    // the atom entirely). Re-fetching here keeps the header in sync without a full page reload.
    const refreshUser = async () => {
        const refreshedUser = await getUserPrivateAction();
        if (refreshedUser) setUser(refreshedUser);
    };

    const goToProfile = async () => {
        await refreshUser();
        router.push(`/circles/${personalCircle.handle}/home`);
    };

    const stepIndex = (orderedSteps as readonly string[]).indexOf(step) + 1;
    const stepLabel = `Step ${stepIndex} of ${orderedSteps.length}`;

    if (step === "photo") {
        return (
            <OnboardingCardShell
                title="Add a photo"
                subtitle="A face helps people recognize you. You can always change this later."
                stepLabel={stepLabel}
                progress={progress}
            >
                <PhotoStep
                    circleId={String(personalCircle._id)}
                    initialPictureUrl={personalCircle.picture?.url}
                    initialImages={personalCircle.images}
                    reassurance="Private by default, so a missing photo carries no risk. No hard requirement."
                    onSaved={() => void refreshUser()}
                    onContinue={() => setStep("about")}
                    onSkip={() => setStep("about")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "about") {
        return (
            <OnboardingCardShell
                title="A short about me"
                subtitle="A sentence or two is plenty."
                stepLabel={stepLabel}
                progress={progress}
            >
                <AboutStep
                    circleId={String(personalCircle._id)}
                    initialValue={personalCircle.description}
                    onContinue={() => setStep("location")}
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
            >
                <LocationStep
                    circleId={String(personalCircle._id)}
                    initialLocation={personalCircle.location}
                    showSearchToggle
                    initialSearchable={personalCircle.searchable ?? true}
                    onContinue={() => setStep("guidelines")}
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
            >
                <GuidelinesStep onAccepted={() => setStep("explainer")} />
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
            >
                <GenresStep
                    circleId={String(personalCircle._id)}
                    initialGenres={personalCircle.primaryGenres}
                    initialGenreOther={personalCircle.primaryGenreOther}
                    onContinue={() => setStep("fan-contribution")}
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
            >
                <ContributionStep
                    onSelected={(value) => setStep(value === "yes" ? "fan-offers-explainer" : "fan-done")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "fan-offers-explainer") {
        return (
            <OnboardingCardShell title="How offers work" stepLabel={stepLabel} progress={progress}>
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
            >
                <OffersStep
                    circleId={String(personalCircle._id)}
                    circleHandle={personalCircle.handle || ""}
                    initialOfferings={personalCircle.tourTeamOfferings}
                    onContinue={() => setStep("fan-done")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "fan-done") {
        return (
            <OnboardingCardShell title="You're in" stepLabel={stepLabel} progress={progress}>
                <FanDoneStep onExplore={() => router.push("/explore")} />
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
            >
                <ArtistTypeStep
                    circleId={String(artistCircle._id)}
                    initialType={artistIdentityType}
                    onSaved={(type) => {
                        setArtistIdentityType(type);
                        setStep("artist-photo");
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
            >
                <PhotoStep
                    circleId={String(artistCircle._id)}
                    initialPictureUrl={artistInitialPictureUrl}
                    initialImages={artistCircle.images}
                    onSaved={() => void refreshUser()}
                    onContinue={() => setStep("artist-about")}
                    onSkip={() => setStep("artist-about")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "artist-about" && artistCircle) {
        return (
            <OnboardingCardShell
                title={
                    artistIdentityType === "band"
                        ? "Describe yourselves in a few words"
                        : "Describe yourself in a few words"
                }
                subtitle="A sentence or two — fans will see this on your profile."
                stepLabel={stepLabel}
                progress={progress}
            >
                <AboutStep
                    circleId={String(artistCircle._id)}
                    initialValue={artistCircle.description}
                    placeholder="Tell fans a little about the music"
                    onContinue={() => setStep("artist-songs")}
                    onSkip={() => setStep("artist-songs")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "artist-songs" && artistCircle) {
        return (
            <OnboardingCardShell
                title="Add a few songs"
                subtitle="Aim for at least three — this is what most fans will hear first. You can always add more later."
                stepLabel={stepLabel}
                progress={progress}
            >
                <SongsStep
                    circleId={String(artistCircle._id)}
                    tracks={initialArtistTracks}
                    onContinue={() => setStep("artist-location")}
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
            >
                <LocationStep
                    circleId={String(artistCircle._id)}
                    initialLocation={artistCircle.location}
                    showSearchToggle={false}
                    onContinue={() => setStep("artist-genres")}
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
            >
                <GenresStep
                    circleId={String(artistCircle._id)}
                    initialGenres={artistCircle.primaryGenres}
                    initialGenreOther={artistCircle.primaryGenreOther}
                    onContinue={() => setStep("artist-ready")}
                    onSkip={() => setStep("artist-ready")}
                />
            </OnboardingCardShell>
        );
    }

    if (step === "artist-ready" && artistCircle && initialArtistReadiness) {
        const goToArtistProfile = () => router.push(`/circles/${artistCircle.handle}`);

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
