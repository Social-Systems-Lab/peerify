"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { getUserPrivateAction } from "@/components/modules/home/actions";
import { Circle, UserPrivate } from "@/models/models";
import type { VerificationReadiness } from "@/lib/verification-readiness";
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
};

export function PilotOnboardingFlow({ personalCircle, artistCircle, initialArtistReadiness }: PilotOnboardingFlowProps) {
    const router = useRouter();
    const [, setUser] = useAtom(userAtom);
    const role: "fan" | "artist" = artistCircle ? "artist" : "fan";
    const [step, setStep] = useState<StepName>("photo");

    const orderedSteps = role === "fan" ? FAN_STEPS : ARTIST_STEPS;
    const progress = useMemo(() => {
        const index = (orderedSteps as readonly string[]).indexOf(step);
        return ((index + 1) / orderedSteps.length) * 100;
    }, [orderedSteps, step]);

    const goToProfile = async () => {
        const refreshedUser = await getUserPrivateAction();
        if (refreshedUser) setUser(refreshedUser);
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

    // Artist-path continuation is wired in as that path is built out.
    return null;
}
