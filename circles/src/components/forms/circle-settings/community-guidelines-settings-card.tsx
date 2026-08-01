"use client";

import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { CheckCircle2 } from "lucide-react";
import { CodeOfConductAgreement } from "@/components/auth/code-of-conduct-agreement";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { isCommunityGuidelinesCompleted } from "@/lib/community-guidelines";
import { userAtom } from "@/lib/data/atoms";
import { hasAboutText, hasCustomPicture } from "@/lib/verification-readiness";
import type { Circle } from "@/models/models";

const formatAcceptedAt = (value?: Date | string | null): string | null => {
    if (!value) {
        return null;
    }

    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    }).format(parsed);
};

// Standalone, proactive entry point for signing Peerify's Community Guidelines from the
// personal profile's own Settings/About page. Before this existed, signing guidelines was
// reachable NOWHERE: the guarded-composer participation gate (see
// src/lib/auth/participation-readiness.ts) deliberately never checks guidelines acceptance,
// and the only other UI that ever rendered the agreement (CodeOfConductAgreement, via
// VerifyAccountButton) has been commented out at all its render sites since the 2026-07-08
// auto-verify migration hid the manual verification flow. That left users with no way to
// satisfy isPilotArtistCircleReadyToPublish's guidelines requirement (src/lib/data/circle.ts)
// no matter what they did on their own profile. Reuses acceptCodeOfConductAction (accepts all
// five rules at once) rather than the separate, unwired rule-by-rule
// CommunityGuidelinesAgreementFlow (src/components/auth/community-guidelines-gate.tsx), to
// match what VerifyAccountButton already does elsewhere and avoid introducing a second
// signing UX.
//
// Presented as onboarding "step 3" — it only appears once picture and About text (steps 1
// and 2) are both filled in, and once ready it auto-opens as a modal the first time (tracked
// per-handle in localStorage, same pattern as the welcome dialog in home-content.tsx) rather
// than sitting embedded mid-page. If dismissed before signing, a one-line reopen affordance
// takes its place so the step isn't stranded.
//
// This reads communityGuidelinesAcceptance off the globally-hydrated userAtom (the VIEWER's
// own data), not off the `circle` prop the rest of this settings page renders from — the
// SAFE_CIRCLE_PROJECTION getCircleByHandle/getCircleById use to fetch `circle` deliberately
// excludes that field (see src/lib/data/circle.ts). Since /settings/about isn't itself
// ownership-gated at the route level (only the save/publish server actions enforce
// isAuthorized), `ownProfileHandle` guards against showing the viewer's own guidelines status
// if they land on someone else's personal-profile settings page.
export function CommunityGuidelinesSettingsCard({
    ownProfileHandle,
    circle,
}: {
    ownProfileHandle?: string;
    circle?: Partial<Circle> | null;
}) {
    const [user, setUser] = useAtom(userAtom);
    const { toast } = useToast();
    const [open, setOpen] = useState(false);

    const isOwnProfile = Boolean(user?.handle && user.handle === ownProfileHandle);
    const completed = isCommunityGuidelinesCompleted(user?.communityGuidelinesAcceptance);
    const readyForStep3 = hasCustomPicture(circle) && hasAboutText(circle);
    const storageKey = ownProfileHandle ? `peerify_guidelines_modal_seen:${ownProfileHandle}` : null;

    useEffect(() => {
        if (!isOwnProfile || completed || !readyForStep3 || !storageKey) {
            return;
        }

        try {
            if (!window.localStorage.getItem(storageKey)) {
                setOpen(true);
            }
        } catch {
            // localStorage unavailable (private mode etc.) — show the modal anyway
            setOpen(true);
        }
    }, [isOwnProfile, completed, readyForStep3, storageKey]);

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);

        if (!nextOpen && storageKey) {
            try {
                window.localStorage.setItem(storageKey, "1");
            } catch {
                // localStorage unavailable — modal just won't remember it was seen this session
            }
        }
    };

    if (!isOwnProfile || !readyForStep3) {
        return null;
    }

    if (completed) {
        const acceptedAtLabel = formatAcceptedAt(user?.communityGuidelinesAcceptedAt);

        return (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                    You agreed to Peerify&apos;s Community Guidelines
                    {acceptedAtLabel ? ` on ${acceptedAtLabel}` : ""}.
                </span>
            </div>
        );
    }

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
                <span>Sign the Community Guidelines to finish your profile.</span>
                <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
                    Sign the Community Guidelines &rarr;
                </Button>
            </div>
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent className="max-w-2xl overflow-hidden p-0">
                    <DialogTitle className="sr-only">Community Guidelines</DialogTitle>
                    <CodeOfConductAgreement
                        user={user}
                        onUserChange={(nextUser) => setUser(nextUser)}
                        onComplete={async () => {
                            toast({ title: "Success", description: "Community Guidelines accepted." });
                            handleOpenChange(false);
                            return { success: true };
                        }}
                    />
                </DialogContent>
            </Dialog>
        </>
    );
}
