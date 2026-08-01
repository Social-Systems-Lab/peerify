"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { VerificationReadinessChecklist } from "@/components/modules/verification/verification-readiness-checklist";
import type { ParticipationState } from "@/lib/auth/participation-readiness";

// Only "profile_incomplete" is a real, server-enforced participation-block
// reason today (see src/lib/auth/participation-readiness.ts) — this dialog's
// copy only covers that case.
type CommunityParticipationDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    participation: ParticipationState;
    profileHandle?: string;
};

export function CommunityParticipationDialog({
    open,
    onOpenChange,
    participation,
    profileHandle,
}: CommunityParticipationDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent onClick={(event) => event.stopPropagation()}>
                <DialogHeader>
                    <DialogTitle>Complete your personal profile to participate</DialogTitle>
                    <DialogDescription>
                        Finish the required profile steps before posting, commenting, or reacting.
                    </DialogDescription>
                </DialogHeader>
                <VerificationReadinessChecklist readiness={participation.readiness} />
                {profileHandle && (
                    <DialogFooter>
                        <Button asChild>
                            <Link href={`/circles/${profileHandle}/settings/about`}>Complete your profile</Link>
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}
