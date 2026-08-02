"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { VerificationReadinessChecklist } from "@/components/modules/verification/verification-readiness-checklist";
import type { VerificationReadiness } from "@/lib/verification-readiness";
import { getPilotArtistReadinessAction } from "@/app/onboarding/pilot/actions";
import { publishCircleAction } from "@/app/circles/[handle]/settings/about/actions";

type ArtistReadyStepProps = {
    circleId: string;
    initialReadiness: VerificationReadiness;
    onGoToProfile: () => void;
    onPublished: () => void;
};

// Artist ready screen. `initialReadiness` was computed once, server-side, at page load —
// stale by the time we get here since picture/About/location/guidelines may all have just
// been saved earlier in this same wizard session. Re-fetches on mount via
// getPilotArtistReadinessAction (a thin wrapper around the existing
// getPilotArtistCircleReadiness(), reused as-is) so the checklist and the Publish button's
// disabled state reflect reality. Publish itself re-validates server-side again regardless
// (publishCircleAction), so a stale client state here can never actually publish an
// incomplete circle — this refetch is a UX nicety, not the enforcement boundary.
export function ArtistReadyStep({ circleId, initialReadiness, onGoToProfile, onPublished }: ArtistReadyStepProps) {
    const { toast } = useToast();
    const [readiness, setReadiness] = useState(initialReadiness);
    const [isRefreshing, setIsRefreshing] = useState(true);
    const [isPublishing, setIsPublishing] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const fresh = await getPilotArtistReadinessAction(circleId);
            if (!cancelled && fresh) {
                setReadiness(fresh);
            }
            if (!cancelled) {
                setIsRefreshing(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [circleId]);

    const handlePublish = async () => {
        setIsPublishing(true);
        try {
            const formData = new FormData();
            formData.append("circleId", circleId);
            const result = await publishCircleAction(formData);
            if (!result.success) {
                toast({ title: "Not ready to publish yet", description: result.message, variant: "destructive" });
                const fresh = await getPilotArtistReadinessAction(circleId);
                if (fresh) setReadiness(fresh);
                return;
            }
            onPublished();
        } finally {
            setIsPublishing(false);
        }
    };

    return (
        <div className="space-y-6">
            <VerificationReadinessChecklist readiness={readiness} />

            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                <Button type="button" variant="outline" className="sm:flex-1" onClick={onGoToProfile}>
                    Go to profile
                </Button>
                <Button
                    type="button"
                    className="sm:flex-1"
                    onClick={handlePublish}
                    disabled={!readiness.isReady || isRefreshing || isPublishing}
                >
                    {isPublishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Publish
                </Button>
            </div>
        </div>
    );
}
