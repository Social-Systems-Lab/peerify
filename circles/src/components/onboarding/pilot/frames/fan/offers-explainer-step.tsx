"use client";

import { HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";

const POINTS = [
    "Your offers show up on the map, but always anonymously. Your offer can't be connected to you by anyone you haven't given access to.",
    "If an artist's need matches your offer, you may get an automatic invite to help.",
    "You always choose whether to respond. Nothing happens without you saying yes.",
    "You can add, remove, or edit these at any time.",
];

type OffersExplainerStepProps = {
    onContinue: () => void;
};

// Frame F3-explainer, only shown after "Yes, tell me more" is selected in Frame F3.
export function OffersExplainerStep({ onContinue }: OffersExplainerStepProps) {
    return (
        <div className="space-y-6">
            <div className="flex justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <HeartHandshake className="h-6 w-6 text-primary" />
                </div>
            </div>

            <ol className="space-y-4">
                {POINTS.map((point, index) => (
                    <li key={index} className="flex gap-3 text-sm">
                        <span className="font-semibold text-primary">{index + 1}.</span>
                        <span>{point}</span>
                    </li>
                ))}
            </ol>

            <Button type="button" className="w-full" onClick={onContinue}>
                Got it — add my offers
            </Button>
        </div>
    );
}
