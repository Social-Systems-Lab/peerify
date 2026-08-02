// community-participation-banner.tsx
"use client";

import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getParticipationState, shouldShowParticipationBanner } from "@/lib/auth/participation-readiness";
import { VerificationReadinessChecklist } from "@/components/modules/verification/verification-readiness-checklist";
import type { Circle } from "@/models/models";

type CommunityParticipationBannerProps = {
    circle: Partial<Circle> | null | undefined;
    // The viewer's own personal ("user"-type) profile. The real participation gate
    // (canPerformRestrictedAction, see src/lib/auth/participation-readiness.ts) is always
    // evaluated against the ACTING user's personal profile, never against whatever circle
    // is currently being viewed — community-feed.tsx/post-list.tsx already call
    // getParticipationState(user) on that basis. This banner renders on non-personal
    // circles too (e.g. an owned artist circle's Home/Settings), so it needs the viewer's
    // personal profile explicitly rather than defaulting to `circle`, or it would show/hide
    // based on the wrong document (an artist circle's own picture/About, which never
    // auto-verifies) and link back to that circle's own Settings/About instead of the
    // personal profile that actually needs completing.
    viewerPersonalProfile?: Partial<Circle> | null;
    // Reuse whatever check the caller already has for "is the viewer this
    // circle's owner or admin" — see isOwnerOrCircleAdmin in
    // src/lib/auth/client-auth.ts. Kept as a plain boolean here so this
    // component stays a simple, pure presentational banner.
    isViewerOwnerOrAdmin: boolean;
    // Settings pages show a condensed completion checklist (same readiness items used
    // by the verification-request flow) alongside the reminder sentence, plus a
    // tinted/bordered container so the banner doesn't read as white-on-white in the
    // Settings layout's wide, unconstrained column. The home/profile page keeps the
    // original plain one-liner it already had.
    showChecklist?: boolean;
};

// Persistent completion-reminder banner for Settings pages and the
// profile/home page — only visible to the circle's own owner/admin, and only
// while getParticipationBlockReason(<viewer's personal profile>) is non-null. No
// dismiss/snooze: it disappears on its own once the profile is complete. Reuses the same
// copy/link as CommunityParticipationDialog so the messaging stays
// consistent with the guarded composer/comment/reaction dialog.
export function CommunityParticipationBanner({
    circle,
    viewerPersonalProfile,
    isViewerOwnerOrAdmin,
    showChecklist,
}: CommunityParticipationBannerProps) {
    // On the viewer's own personal-profile page, `circle` already IS that profile.
    // Everywhere else (artist/venue/community circles the viewer owns or manages), the
    // subject must be the viewer's own personal profile, not the circle being viewed.
    const readinessSubject = circle?.circleType === "user" ? circle : viewerPersonalProfile;

    if (!shouldShowParticipationBanner(readinessSubject, isViewerOwnerOrAdmin) || !readinessSubject?.handle) {
        return null;
    }

    const readiness = showChecklist ? getParticipationState(readinessSubject).readiness : null;

    return (
        <div className="mb-4 space-y-3">
            <Alert>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                        Complete your <strong>personal profile</strong> to post, comment, and react in the Community.
                    </span>
                    <Button asChild size="sm" className="shrink-0">
                        <Link href="/onboarding/pilot">Complete profile</Link>
                    </Button>
                </AlertDescription>
            </Alert>
            {readiness ? <VerificationReadinessChecklist readiness={readiness} /> : null}
        </div>
    );
}
