"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { saveArtistActFormatAction } from "@/app/onboarding/pilot/actions";
import { PEERIFY_ACT_FORMAT_OPTIONS, type PeerifyActFormat } from "@/lib/peerify/artist-profile";

type ArtistTypeStepProps = {
    circleId: string;
    initialFormat: PeerifyActFormat;
    onSaved: (actFormat: PeerifyActFormat) => void;
};

// Frame A2. No skip — the format decides the default avatar shown in Frame A3, so it must be
// answered before moving on. saveArtistActFormatAction writes artistProfile.actFormat and the
// identityType it implies (getIdentityTypeForActFormat), which the default avatar, hero and
// label key off. createPilotArtistCircle defaults new artist circles to identityType "artist".
export function ArtistTypeStep({ circleId, initialFormat, onSaved }: ArtistTypeStepProps) {
    const { toast } = useToast();
    const [selected, setSelected] = useState<PeerifyActFormat>(initialFormat);
    const [isSaving, setIsSaving] = useState(false);

    const handleContinue = async () => {
        setIsSaving(true);
        try {
            const result = await saveArtistActFormatAction(circleId, selected);
            if (!result.success) {
                toast({ title: "Couldn't save", description: result.message, variant: "destructive" });
                return;
            }
            onSaved(selected);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2">
                {PEERIFY_ACT_FORMAT_OPTIONS.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => setSelected(option.value)}
                        className={cn(
                            "rounded-lg border p-4 text-left text-sm font-medium transition-colors",
                            selected === option.value ? "border-primary bg-primary/5" : "hover:border-primary/40",
                        )}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            <Button type="button" className="w-full" onClick={handleContinue} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Continue
            </Button>
        </div>
    );
}
