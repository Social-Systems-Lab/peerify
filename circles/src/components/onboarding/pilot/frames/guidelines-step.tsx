"use client";

import { useEffect, useRef, useState } from "react";
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
    const viewportRef = useRef<HTMLDivElement>(null);
    // One-way latch — once true, stays true (scrolling back up shouldn't punish someone who
    // already proved they read to the end). Also covers the "content is short enough to fit
    // without scrolling on this screen size" case: the initial check runs before any scroll
    // event ever fires, so it auto-satisfies immediately rather than permanently blocking.
    const [hasScrolledToEnd, setHasScrolledToEnd] = useState(false);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const checkScrollEnd = () => {
            const { scrollTop, scrollHeight, clientHeight } = viewport;
            if (scrollHeight - scrollTop - clientHeight <= 4) {
                setHasScrolledToEnd(true);
            }
        };

        checkScrollEnd();
        viewport.addEventListener("scroll", checkScrollEnd);
        window.addEventListener("resize", checkScrollEnd);
        return () => {
            viewport.removeEventListener("scroll", checkScrollEnd);
            window.removeEventListener("resize", checkScrollEnd);
        };
    }, []);

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
            <ScrollArea
                type="always"
                className="h-48 rounded-lg border p-4"
                viewportRef={viewportRef}
                scrollbarClassName="w-3"
                thumbClassName="bg-primary/50 hover:bg-primary/70"
            >
                <div className="space-y-4">
                    {COMMUNITY_GUIDELINE_RULES.map((rule) => (
                        <div key={rule.id} className="space-y-1">
                            <p className="text-sm font-medium">{rule.title}</p>
                            <p className="text-sm text-muted-foreground">{rule.body}</p>
                        </div>
                    ))}
                </div>
            </ScrollArea>

            <div className="space-y-2">
                <div className="flex items-start gap-3 rounded-lg border p-4">
                    <Checkbox
                        id="onboarding-guidelines-agree"
                        checked={agreed}
                        onCheckedChange={(checked) => setAgreed(checked === true)}
                        disabled={isSaving || !hasScrolledToEnd}
                        className="mt-0.5"
                    />
                    <Label htmlFor="onboarding-guidelines-agree" className="text-sm leading-6">
                        I&apos;ve read and agree to the Community Guidelines
                    </Label>
                </div>
                {!hasScrolledToEnd ? (
                    <p className="text-xs text-muted-foreground">Scroll to the end of the guidelines above to continue.</p>
                ) : null}
            </div>

            <Button type="button" className="w-full" onClick={handleContinue} disabled={!agreed || isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Agree &amp; continue
            </Button>
        </div>
    );
}
