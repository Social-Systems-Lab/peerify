"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { saveArtistIdentityTypeAction } from "@/app/onboarding/pilot/actions";

type ArtistIdentityType = "artist" | "band";

const OPTIONS: { value: ArtistIdentityType; label: string }[] = [
    { value: "artist", label: "Solo artist" },
    { value: "band", label: "Band / collective" },
];

type ArtistTypeStepProps = {
    circleId: string;
    initialType: ArtistIdentityType;
    onSaved: (type: ArtistIdentityType) => void;
};

// Frame A2. No skip — this determines the default avatar shown in Frame A3, so it must be
// answered before moving on. Writes metadata.peerify.identityType, which the existing
// getPeerifyDefaultAvatarUrl()/getPeerifyIdentityAvatarUrl() helpers and
// PEERIFY_MANAGED_IDENTITY_TYPE_LABELS already key off — createPilotArtistCircle always
// defaults new artist circles to "artist", so this is the only place "band" ever gets set.
export function ArtistTypeStep({ circleId, initialType, onSaved }: ArtistTypeStepProps) {
    const { toast } = useToast();
    const [selected, setSelected] = useState<ArtistIdentityType>(initialType);
    const [isSaving, setIsSaving] = useState(false);

    const handleContinue = async () => {
        setIsSaving(true);
        try {
            const result = await saveArtistIdentityTypeAction(circleId, selected);
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
                {OPTIONS.map((option) => (
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
