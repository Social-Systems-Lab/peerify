"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { saveArtistActOffersAction } from "@/app/onboarding/pilot/actions";
import { PEERIFY_ACT_OFFER_OPTIONS, type PeerifyActOffer } from "@/lib/peerify/artist-profile";
import { PEERIFY_ACT_OFFER_ICONS } from "@/lib/peerify/act-offer-icons";

type WhatYouDoStepProps = {
    circleId: string;
    initialActOffers: PeerifyActOffer[];
    onContinue: () => void;
    onSkip: () => void;
};

// Frame A2b, right after the format step: the same "What you do" values as Settings › About and
// the Discover/Explore filter row. Skippable, unlike A2 — nothing else depends on it. Continue
// saves the selection (an emptied one clears what was stored); Skip saves nothing.
export function WhatYouDoStep({ circleId, initialActOffers, onContinue, onSkip }: WhatYouDoStepProps) {
    const { toast } = useToast();
    const [selected, setSelected] = useState<PeerifyActOffer[]>(initialActOffers);
    const [isSaving, setIsSaving] = useState(false);

    const toggle = (value: PeerifyActOffer) =>
        setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

    const handleContinue = async () => {
        if (selected.length === 0 && initialActOffers.length === 0) {
            onContinue();
            return;
        }

        setIsSaving(true);
        try {
            const result = await saveArtistActOffersAction(circleId, selected);
            if (!result.success) {
                toast({ title: "Couldn't save", description: result.message, variant: "destructive" });
                return;
            }
            onContinue();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
                {PEERIFY_ACT_OFFER_OPTIONS.map((option) => {
                    const Icon = PEERIFY_ACT_OFFER_ICONS[option.value];
                    const isSelected = selected.includes(option.value);
                    return (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => toggle(option.value)}
                            className={cn(
                                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                                isSelected
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "bg-background hover:border-primary/60",
                            )}
                        >
                            <Icon className="h-4 w-4" aria-hidden />
                            {option.label}
                        </button>
                    );
                })}
            </div>

            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                <Button type="button" variant="outline" className="sm:flex-1" onClick={onSkip} disabled={isSaving}>
                    Skip for now
                </Button>
                <Button type="button" className="sm:flex-1" onClick={handleContinue} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Continue
                </Button>
            </div>
        </div>
    );
}
