"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { savePilotAboutAction } from "@/app/onboarding/pilot/actions";

const ABOUT_MAX_LENGTH = 300;

type AboutStepProps = {
    circleId: string;
    initialValue?: string;
    placeholder?: string;
    onSaved?: (description: string) => void;
    onContinue: () => void;
    onSkip: () => void;
};

export function AboutStep({ circleId, initialValue, placeholder, onSaved, onContinue, onSkip }: AboutStepProps) {
    const { toast } = useToast();
    const [value, setValue] = useState(initialValue || "");
    const [isSaving, setIsSaving] = useState(false);

    const handleContinue = async () => {
        const trimmed = value.trim();
        if (trimmed === (initialValue || "").trim()) {
            onContinue();
            return;
        }

        setIsSaving(true);
        try {
            const result = await savePilotAboutAction(circleId, trimmed);
            if (!result.success) {
                toast({ title: "Couldn't save", description: result.message, variant: "destructive" });
                return;
            }
            onSaved?.(trimmed);
            onContinue();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Textarea
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder={placeholder || "Tell people a little about yourself"}
                    maxLength={ABOUT_MAX_LENGTH}
                    className="min-h-[120px]"
                />
                <p className="text-right text-xs text-muted-foreground">
                    {value.length}/{ABOUT_MAX_LENGTH}
                </p>
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
