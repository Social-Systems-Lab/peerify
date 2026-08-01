"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/use-toast";
import { acceptCodeOfConductAction } from "@/components/auth/actions";
import { COMMUNITY_GUIDELINE_RULES } from "@/lib/community-guidelines";

// Frame 1d. Deliberately does NOT reuse CodeOfConductAgreement's own JSX (that component's
// title/checkbox copy still says "Code of Conduct" verbatim, which this frame is required to
// never show) — it reuses the same acceptCodeOfConductAction the settings-page
// CommunityGuidelinesSettingsCard already calls, just with fresh "Community Guidelines" copy.
type GuidelinesStepProps = {
    onAccepted: () => void;
};

export function GuidelinesStep({ onAccepted }: GuidelinesStepProps) {
    const { toast } = useToast();
    const [agreed, setAgreed] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const handleContinue = async () => {
        if (!agreed) return;

        setIsSaving(true);
        try {
            const result = await acceptCodeOfConductAction();
            if (!result.success) {
                toast({ title: "Couldn't save", description: result.message, variant: "destructive" });
                return;
            }
            onAccepted();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <ScrollArea className="h-48 rounded-lg border p-4">
                <div className="space-y-4">
                    {COMMUNITY_GUIDELINE_RULES.map((rule) => (
                        <div key={rule.id} className="space-y-1">
                            <p className="text-sm font-medium">{rule.title}</p>
                            <p className="text-sm text-muted-foreground">{rule.body}</p>
                        </div>
                    ))}
                </div>
            </ScrollArea>

            <div className="flex items-start gap-3 rounded-lg border p-4">
                <Checkbox
                    id="onboarding-guidelines-agree"
                    checked={agreed}
                    onCheckedChange={(checked) => setAgreed(checked === true)}
                    disabled={isSaving}
                    className="mt-0.5"
                />
                <Label htmlFor="onboarding-guidelines-agree" className="text-sm leading-6">
                    I&apos;ve read and agree to the Community Guidelines
                </Label>
            </div>

            <Button type="button" className="w-full" onClick={handleContinue} disabled={!agreed || isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Agree &amp; continue
            </Button>
        </div>
    );
}
