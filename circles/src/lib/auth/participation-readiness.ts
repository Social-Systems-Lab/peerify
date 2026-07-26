// Community participation-readiness reason model.
//
// The server's real "can this user post/comment/react" gate is
// canPerformRestrictedAction (isVerifiedUser OR isAdmin bypass) — see
// createPostAction in src/components/modules/feeds/actions.ts and
// isAuthorized's needsToBeVerified branch in src/lib/auth/auth.ts. Today,
// isVerifiedUser is only ever set once a profile's picture + About text are
// both complete (see getVerificationReadiness / updateCircle's auto-verify),
// so "profile_incomplete" is the one real, server-enforced blocking reason.
// Email verification and Community Guidelines acceptance are separate,
// independently-tracked fields that do not currently affect this gate — this
// helper mirrors canPerformRestrictedAction exactly rather than inventing a
// stricter check, so it can never drift from what the server actually denies.
import type { Circle } from "@/models/models";
import { canPerformRestrictedAction } from "@/lib/auth/verification";
import { getVerificationReadiness, type VerificationReadiness } from "@/lib/verification-readiness";

export type ParticipationBlockReason = "profile_incomplete" | null;

export type ParticipationState = {
    canParticipate: boolean;
    blockReason: ParticipationBlockReason;
    readiness: VerificationReadiness;
};

type ParticipationSubject = Partial<Circle> | null | undefined;

export function getParticipationBlockReason(user: ParticipationSubject): ParticipationBlockReason {
    return canPerformRestrictedAction(user) ? null : "profile_incomplete";
}

export function getParticipationState(user: ParticipationSubject): ParticipationState {
    const blockReason = getParticipationBlockReason(user);
    return {
        canParticipate: blockReason === null,
        blockReason,
        readiness: getVerificationReadiness(user),
    };
}

// Visibility rule for the Settings/profile completion-reminder banner: only
// the circle's own owner/admin should see that ITS profile is incomplete
// (reused check, not computed here — see isOwnerOrCircleAdmin in
// src/lib/auth/client-auth.ts), and only while it's actually incomplete.
export function shouldShowParticipationBanner(
    circle: ParticipationSubject,
    isViewerOwnerOrAdmin: boolean,
): boolean {
    return isViewerOwnerOrAdmin && getParticipationBlockReason(circle) !== null;
}
