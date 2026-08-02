"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import { saveContributionInterestAction } from "@/app/onboarding/pilot/actions";

type ContributionValue = "yes" | "maybe" | "no";

const OPTIONS: { value: ContributionValue; label: string }[] = [
    { value: "yes", label: "Yes, tell me more" },
    { value: "maybe", label: "Maybe later" },
    { value: "no", label: "Not for me" },
];

type ContributionStepProps = {
    initialValue?: ContributionValue;
    onSelected: (value: ContributionValue) => void;
};

// Frame F3. Tap-to-select, then a single Continue button — not three immediate-action
// buttons. "Maybe later" is stored distinct from "Not for me" (see saveContributionInterestAction)
// so a future ~30-day check-in nudge can target it; that reminder job itself isn't built here.
// initialValue lets the Back button (pilot-onboarding-flow.tsx) return here without losing an
// already-made choice.
export function ContributionStep({ initialValue, onSelected }: ContributionStepProps) {
    const { toast } = useToast();
    const [value, setValue] = useState<ContributionValue | null>(initialValue ?? null);
    const [isSaving, setIsSaving] = useState(false);

    const handleContinue = async () => {
        if (!value) return;

        setIsSaving(true);
        try {
            const result = await saveContributionInterestAction(value);
            if (!result.success) {
                toast({ title: "Couldn't save", description: result.message, variant: "destructive" });
                return;
            }
            onSelected(value);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                {OPTIONS.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => setValue(option.value)}
                        className={cn(
                            "w-full rounded-lg border p-4 text-left text-sm font-medium transition-colors",
                            value === option.value ? "border-primary bg-primary/5" : "hover:border-primary/40",
                        )}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            <Button type="button" className="w-full" onClick={handleContinue} disabled={!value || isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Continue
            </Button>
        </div>
    );
}
