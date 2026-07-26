// community-participation-banner.tsx
"use client";

import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { shouldShowParticipationBanner } from "@/lib/auth/participation-readiness";
import type { Circle } from "@/models/models";

type CommunityParticipationBannerProps = {
    circle: Partial<Circle> | null | undefined;
    // Reuse whatever check the caller already has for "is the viewer this
    // circle's owner or admin" — see isOwnerOrCircleAdmin in
    // src/lib/auth/client-auth.ts. Kept as a plain boolean here so this
    // component stays a simple, pure presentational banner.
    isViewerOwnerOrAdmin: boolean;
};

// Persistent completion-reminder banner for Settings pages and the
// profile/home page — only visible to the circle's own owner/admin, and only
// while getParticipationBlockReason(circle) is non-null. No dismiss/snooze:
// it disappears on its own once the profile is complete. Reuses the same
// copy/link as CommunityParticipationDialog so the messaging stays
// consistent with the guarded composer/comment/reaction dialog.
export function CommunityParticipationBanner({ circle, isViewerOwnerOrAdmin }: CommunityParticipationBannerProps) {
    if (!shouldShowParticipationBanner(circle, isViewerOwnerOrAdmin) || !circle?.handle) {
        return null;
    }

    return (
        <Alert className="mb-4">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>Complete your profile to post, comment, and react in the Community.</span>
                <Link
                    href={`/circles/${circle.handle}/settings/about`}
                    className="whitespace-nowrap font-medium text-primary hover:underline"
                >
                    Complete your profile →
                </Link>
            </AlertDescription>
        </Alert>
    );
}
