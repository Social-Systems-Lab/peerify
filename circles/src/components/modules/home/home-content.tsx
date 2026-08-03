"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Circle } from "@/models/models";
import { FaUsers } from "react-icons/fa";
import EditableImage from "./editable-image";
import EditableField from "./editable-field";
import InviteButton from "./invite-button";
import ChatButton from "./chat-button";
import FollowButton from "./follow-button";
import BookmarkButton from "./bookmark-button";
import GalleryTrigger from "./gallery-trigger";
import { useIsCompact } from "@/components/utils/use-is-compact";
import { LOG_LEVEL_TRACE, logLevel } from "@/lib/data/constants";
import { MessageButton } from "./message-button";
import { userAtom, PILOT_ONBOARDING_COMPLETED_STORAGE_KEY } from "@/lib/data/atoms";
import { useAtom } from "jotai";
import { NotificationSettingsDialog } from "@/components/notifications/NotificationSettingsDialog";
import { Button } from "@/components/ui/button";
import { BarChart3, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PublishManagedProfileButton } from "@/components/profiles/publish-managed-profile-button";
import { VerifyAccountButton } from "../auth/verify-account-button";
import SocialLinks from "./social-links";
import { ProofOfHumanityHeaderAction } from "./proof-of-humanity-card";
import type { HumanityVerificationSummary } from "@/lib/data/proof-of-humanity";
import { isVerifiedUser } from "@/lib/auth/verification";
import { hasContributorPerks } from "@/lib/auth/perks";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
    formatPrimaryGenreLabel,
    getPeerifyArtistProfile,
    getPeerifyIdentityAvatarUrl,
    isPeerifyArtistIdentity,
    isPeerifyManagedIdentity,
} from "@/lib/peerify/artist-profile";

type HomeContentProps = {
    circle: Circle;
    authorizedToEdit: boolean;
    viewerDid?: string | null;
    parentCircle?: Circle;
    proofOfHumanitySummary?: HumanityVerificationSummary | null;
    // Whether the viewer already has a pilot-signup-provisioned artist circle — branches
    // the welcome dialog copy away from telling them to go create one.
    hasAutoProvisionedArtistCircle?: boolean;
    // Whether the circle being viewed IS the viewer's own pilot-signup-provisioned artist
    // circle — artist-path signups land here directly (see verifyEmailAction in
    // src/app/(auth)/verify-email/actions.ts), so the welcome dialog needs to trigger on
    // this circle too, not just the viewer's personal profile.
    isOwnAutoProvisionedArtistCircle?: boolean;
    // Server-computed (see isPilotArtistCircleReadyToPublish in src/lib/data/circle.ts):
    // false only when this is a draft pilot-signup-provisioned artist circle that hasn't yet
    // met the auto-publish completion bar. Defaults to true so it never blocks the "Publish
    // profile" button for manually-created (CircleWizard) managed identities.
    pilotArtistCirclePublishReady?: boolean;
};

export default function HomeContent({
    circle,
    authorizedToEdit,
    viewerDid,
    parentCircle,
    proofOfHumanitySummary,
    hasAutoProvisionedArtistCircle,
    isOwnAutoProvisionedArtistCircle,
    pilotArtistCirclePublishReady = true,
}: HomeContentProps) {
    const isUser = circle?.circleType === "user";
    const isKamooniRootCircle = circle?.handle === "default" || circle?.handle === "kamooni";
    const resolvedCircleLevel =
        circle.circleLevel ||
        (circle.parentCircleId && parentCircle?.circleType === "user" ? "profile_child" : undefined);
    const memberCount = circle?.members ? (isUser ? circle.members - 1 : circle.members) : 0;
    const isCompact = useIsCompact();
    const router = useRouter();
    const [user] = useAtom(userAtom);
    const isOwnUserProfile = isUser && (user?.did === circle.did || viewerDid === circle.did);
    // Gates the welcome dialog: the viewer's own personal profile, or the viewer's own
    // freshly auto-provisioned artist profile (where artist-path signups now land).
    const isOwnLandingProfile = isOwnUserProfile || Boolean(isOwnAutoProvisionedArtistCircle);
    // isOwnAutoProvisionedArtistCircle only means "this is the viewer's own auto-provisioned
    // artist circle" — true from the moment it's created in "draft" state, independent of
    // publishStatus. The congrats copy below must only show once the circle is actually live.
    const isOwnArtistCircleLive = Boolean(isOwnAutoProvisionedArtistCircle) && circle.publishStatus === "published";
    const [showWelcomeDialog, setShowWelcomeDialog] = useState(false);
    const showSettingsButton = authorizedToEdit && circle.handle && (!isUser || isOwnUserProfile);
    const settingsButtonTitle = isUser || isPeerifyManagedIdentity(circle) ? "Profile settings" : "Circle settings";
    const settingsButtonClassName =
        "h-9 w-9 shrink-0 rounded-full border border-emerald-950 bg-emerald-950 text-white shadow-sm transition-colors hover:bg-emerald-900 focus-visible:ring-2 focus-visible:ring-emerald-950 focus-visible:ring-offset-2";
    const isPeerifyArtistProfile = isPeerifyArtistIdentity(circle);
    const isPeerifyManagedArtistIdentity = isPeerifyManagedIdentity(circle);
    const peerifyArtistProfile = getPeerifyArtistProfile(circle);
    const showManagedDraftBanner =
        authorizedToEdit && isPeerifyManagedArtistIdentity && (circle.publishStatus ?? "published") === "draft";
    const showPledgesDashboardButton = authorizedToEdit && isPeerifyManagedArtistIdentity && Boolean(circle.handle);
    const circlePictureUrl = isPeerifyManagedArtistIdentity
        ? getPeerifyIdentityAvatarUrl(circle)
        : circle?.picture?.url ?? "/images/default-picture.png";
    const isMember = useMemo(() => {
        if (!user) return false;
        const membership = user.memberships?.find((m) => m.circleId === circle._id);
        return membership ? true : false;
    }, [circle._id, user]);

    useEffect(() => {
        if (logLevel >= LOG_LEVEL_TRACE) {
            console.log("useEffect.HomeContent.1");
        }
    }, []);

    // Scoped to the artist circle's own publish state (draft vs. published) so dismissing
    // the pre-publish welcome dialog doesn't permanently suppress the real congrats dialog
    // once the circle actually goes live later — that's a different key, so it re-arms.
    const welcomeDialogStorageKey = circle.handle
        ? isOwnAutoProvisionedArtistCircle
            ? `kamooni:p_profile_welcome_seen:${circle.handle}:${isOwnArtistCircleLive ? "published" : "draft"}`
            : `kamooni:p_profile_welcome_seen:${circle.handle}`
        : null;

    useEffect(() => {
        if (!isOwnLandingProfile || !welcomeDialogStorageKey) {
            setShowWelcomeDialog(false);
            return;
        }

        const completedOnboardingSteps = circle.completedOnboardingSteps ?? [];
        const hasSeenWelcomeOnboarding =
            completedOnboardingSteps.includes("welcome") ||
            completedOnboardingSteps.includes("member") ||
            completedOnboardingSteps.includes("final");
        // Anyone whose account came through the guided /onboarding/pilot sequence already got
        // (or is currently getting) a tailored walkthrough — showing this generic popup is
        // redundant, and its "are you an artist, use the Create button" copy is actively
        // nonsensical on someone's own just-built artist circle. Keyed off the account's real
        // signup metadata (set once, at account creation, in pilot-signup-form.tsx: `metadata:
        // { onboardingFlow: "pilot-quick-signup", ... }`) rather than only a completion-triggered
        // localStorage flag — that flag (see PILOT_ONBOARDING_COMPLETED_STORAGE_KEY) only ever
        // gets set at the flow's exit points, so someone who abandoned the flow partway through
        // (never reaching any of those points) still slipped through and saw this popup. Signup
        // metadata is persisted the moment the account exists, so it catches every abort point
        // without needing to instrument each one individually. For the artist-circle-viewing
        // case, `isOwnAutoProvisionedArtistCircle` IS already an equally reliable pilot-signup
        // signal — that flag is exclusively set by the same createPilotArtistCircle path.
        const cameThroughPilotSignup =
            (isOwnUserProfile && circle.metadata?.onboardingFlow === "pilot-quick-signup") ||
            Boolean(isOwnAutoProvisionedArtistCircle);
        const hasCompletedPilotOnboarding = Boolean(
            window.localStorage.getItem(PILOT_ONBOARDING_COMPLETED_STORAGE_KEY),
        );
        // Deliberately does NOT suppress the `isOwnArtistCircleLive` congrats copy below —
        // that's a distinct, legitimate one-time celebration for the moment the circle actually
        // goes live, not the redundant generic welcome.
        const shouldSuppressWelcomeDialog =
            isVerifiedUser(circle) ||
            hasContributorPerks(circle) ||
            hasSeenWelcomeOnboarding ||
            ((cameThroughPilotSignup || hasCompletedPilotOnboarding) && !isOwnArtistCircleLive);

        if (shouldSuppressWelcomeDialog) {
            setShowWelcomeDialog(false);
            return;
        }

        const alreadySeen = window.localStorage.getItem(welcomeDialogStorageKey);

        if (!alreadySeen) {
            setShowWelcomeDialog(true);
        }
    }, [
        circle,
        isOwnLandingProfile,
        welcomeDialogStorageKey,
        isOwnArtistCircleLive,
        isOwnAutoProvisionedArtistCircle,
        isOwnUserProfile,
    ]);

    const handleWelcomeDialogChange = (nextOpen: boolean) => {
        setShowWelcomeDialog(nextOpen);

        if (!nextOpen && welcomeDialogStorageKey) {
            window.localStorage.setItem(welcomeDialogStorageKey, "1");
        }
    };

    const openPeerifyArtistEnquiry = (type: "pledge" | "booking") => {
        if (circle.handle && !window.location.pathname.endsWith(`/circles/${circle.handle}/home`)) {
            window.location.href = `/circles/${circle.handle}/home?artistAction=${type}#artist-actions`;
            return;
        }

        window.dispatchEvent(new CustomEvent("peerify:open-artist-enquiry", { detail: { type } }));
    };

    return (
        <>
            <Dialog open={showWelcomeDialog} onOpenChange={handleWelcomeDialogChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {isOwnArtistCircleLive
                                ? `Congratulations, ${circle.name}'s public profile is live!`
                                : "Welcome to Peerify"}
                        </DialogTitle>
                        <DialogDescription className="space-y-3">
                            {isOwnArtistCircleLive ? (
                                <p>
                                    You can switch between this profile and your personal profile anytime using
                                    the <strong>profile switcher</strong> (tap your profile picture in the
                                    top-right corner). Use the switcher to post as yourself or as{" "}
                                    <strong>{circle.name}</strong>, and create more public profiles using the{" "}
                                    <strong>Create</strong> button.
                                </p>
                            ) : hasAutoProvisionedArtistCircle ? (
                                <>
                                    <p>
                                        Complete your <strong>personal profile</strong> with a picture and a short
                                        bio to start posting, commenting, and messaging.
                                    </p>
                                    <p>
                                        You already have a public <strong>artist profile</strong> set up. Switch
                                        between it and this personal profile anytime using the{" "}
                                        <strong>profile switcher</strong> (tap your profile picture in the
                                        top-right corner).
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p>
                                        <strong>Complete your profile</strong> with a picture and a short bio to
                                        start posting, commenting, and messaging.
                                    </p>
                                    <p>
                                        Your profile is <strong>private by default</strong>, but you can share it
                                        through Settings &rarr; Discoverability. Just <strong>be mindful</strong>{" "}
                                        about sharing personal details like your location publicly.
                                    </p>
                                    <p>
                                        Are you <strong>an artist</strong> or represent{" "}
                                        <strong>a band or venue</strong>? You can also create a public profile
                                        later — just use <strong>the Create button</strong> in the left
                                        navigation bar whenever you&apos;re ready. You can easily switch between
                                        your personal and public profiles.
                                    </p>
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" onClick={() => handleWelcomeDialogChange(false)}>
                            Got it
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="flex flex-1 flex-row justify-center">
                <div className="mb-0 ml-4 mr-4 flex max-w-[1100px] flex-1 flex-col">
                    {showManagedDraftBanner && (
                        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
                            <p>
                                <span className="font-semibold">Draft profile</span> — only you and profile managers can
                                see this.{" "}
                                {pilotArtistCirclePublishReady
                                    ? "Publish when you're ready to share it."
                                    : "Add a picture, About text, and a map location here, and sign the Community Guidelines on your personal profile, before you can publish it."}
                            </p>
                            <div className="flex shrink-0 items-center gap-2">
                                {/* Only for the pilot-auto-provisioned circle the guided wizard actually knows how
                                    to resume — a manually-created (CircleWizard) managed identity isn't reachable
                                    from /onboarding/pilot, which would otherwise silently land the owner on the
                                    fan path instead of this circle. */}
                                {!pilotArtistCirclePublishReady && isOwnAutoProvisionedArtistCircle ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="border-amber-900 text-amber-900 hover:bg-amber-100"
                                        onClick={() => {
                                            // A plain <Link> here can resolve to a stale RSC payload for
                                            // /onboarding/pilot cached from earlier in this browser session
                                            // (e.g. right after signup, before the personal phase — or this
                                            // artist phase — was actually completed), because the route has no
                                            // distinguishing search params and no loading.tsx to force a real
                                            // fetch on click. page.tsx's own resume-point logic (which decides
                                            // "photo" vs. "artist-solo-band") is already correct — confirmed by
                                            // hitting the live server directly, bypassing the client entirely —
                                            // so router.refresh() right after navigating (the same idiom
                                            // PilotOnboardingFlow's own advanceStep already uses to keep itself
                                            // fresh) is enough to force that correct logic to actually run,
                                            // rather than reusing a stale cached instance.
                                            router.push("/onboarding/pilot");
                                            router.refresh();
                                        }}
                                    >
                                        Continue setup
                                    </Button>
                                ) : null}
                                {circle._id ? (
                                    <PublishManagedProfileButton
                                        circleId={circle._id}
                                        label="Publish profile"
                                        className="bg-amber-900 text-white hover:bg-amber-800"
                                        disabled={!pilotArtistCirclePublishReady}
                                        disabledReason="Complete this profile's picture, About text, and map location, and sign the Community Guidelines on your personal profile, before publishing."
                                    />
                                ) : null}
                            </div>
                        </div>
                    )}
                    <div className={`relative flex ${isCompact ? "flex-col items-center justify-center" : "flex-row"}`}>
                        <div
                            className={`relative flex ${isCompact ? "h-[50px] w-[100px]" : "h-[125px] w-[150px] min-w-[150px]"}`}
                        >
                            <div
                                className={`absolute ${
                                    isCompact ? "left-1/2 top-[-50px] -translate-x-1/2" : "top-[-25px]"
                                }`}
                            >
                                <div
                                    className={`relative ${isCompact ? "h-[100px] w-[100px]" : "h-[150px] w-[150px]"}`}
                                >
                                    {authorizedToEdit ? (
                                        <EditableImage
                                            id="picture"
                                            src={circlePictureUrl}
                                            alt="Picture"
                                            className="rounded-full border-2 border-white bg-white object-cover shadow-lg"
                                            fill
                                            circleId={circle._id!}
                                            triggerGallery={true}
                                            sizes="(max-width: 768px) 100px, 150px"
                                        />
                                    ) : (
                                        <>
                                            <Image
                                                className="rounded-full border-2 border-white bg-white object-cover shadow-lg"
                                                src={circlePictureUrl}
                                                alt="Picture"
                                                fill
                                                sizes="(max-width: 768px) 100px, 150px"
                                            />
                                            <div className="absolute top-0 h-full w-full">
                                                <GalleryTrigger
                                                    name="Profile Picture"
                                                    images={
                                                        circle.picture
                                                            ? [
                                                                  {
                                                                      name: "Profile Picture",
                                                                      type: "image",
                                                                      fileInfo: circle.picture,
                                                                  },
                                                              ]
                                                            : []
                                                    }
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        {isCompact && isUser && (
                            <>
                                <div className="absolute left-0 top-0 flex flex-row gap-1 pt-2">
                                    <MessageButton circle={circle} renderCompact={false} />
                                </div>

                                <div className="absolute right-0 top-0 flex flex-row items-center gap-1 pt-2">
                                    {user && circle.circleType === "circle" && isMember && (
                                        <ChatButton circle={circle} />
                                    )}
                                    {!isUser && !isPeerifyManagedArtistIdentity && <InviteButton circle={circle} />}
                                    {user && <FollowButton circle={circle} />}
                                    {user && <BookmarkButton circle={circle} iconOnly />}
                                    {showSettingsButton && (
                                        <Button
                                            asChild
                                            variant="outline"
                                            size="icon"
                                            className={settingsButtonClassName}
                                        >
                                            <Link
                                                href={`/circles/${circle.handle}/settings/about`}
                                                aria-label={`Open ${circle.name ?? "circle"} settings`}
                                                title={settingsButtonTitle}
                                            >
                                                <Settings className="h-5 w-5" />
                                            </Link>
                                        </Button>
                                    )}
                                    {circle._id && user && (
                                        <NotificationSettingsDialog
                                            entityType="CIRCLE"
                                            entityId={circle._id.toString()}
                                            className="h-8 w-8 p-0"
                                        />
                                    )}
                                </div>
                            </>
                        )}

                        <div
                            className={`flex flex-col justify-start p-4 pl-6 ${
                                isCompact ? "items-center text-center" : "min-w-0 flex-1 items-start"
                            }`}
                        >
                            <div
                                className={`flex w-full ${isCompact ? "justify-center" : "items-start justify-between gap-4"}`}
                            >
                                <div className="flex min-w-0 flex-wrap items-center gap-4">
                                    <h4 className="m-0 p-0 text-4xl font-bold text-gray-800">
                                        {authorizedToEdit ? (
                                            <EditableField id="name" value={circle.name ?? ""} circleId={circle._id!} />
                                        ) : (
                                            circle.name
                                        )}
                                    </h4>
                                    {proofOfHumanitySummary && !isPeerifyManagedArtistIdentity && (
                                        <ProofOfHumanityHeaderAction circle={circle} summary={proofOfHumanitySummary} />
                                    )}
                                </div>

                                {!isCompact && (
                                    <div className="flex shrink-0 flex-row items-center gap-1">
                                        <div className="pr-4 pt-2">
                                            <SocialLinks circle={circle} />
                                        </div>
                                        {isUser && <MessageButton circle={circle} renderCompact={false} />}
                                        {user && circle.circleType === "circle" && isMember && (
                                            <ChatButton circle={circle} />
                                        )}
                                        {!isUser && !isPeerifyManagedArtistIdentity && <InviteButton circle={circle} />}
                                        {user && <FollowButton circle={circle} />}
                                        {user && <BookmarkButton circle={circle} iconOnly />}
                                        {showSettingsButton && (
                                            <Button
                                                asChild
                                                variant="outline"
                                                size="icon"
                                                className={settingsButtonClassName}
                                            >
                                                <Link
                                                    href={`/circles/${circle.handle}/settings/about`}
                                                    aria-label={`Open ${circle.name ?? "circle"} settings`}
                                                    title={settingsButtonTitle}
                                                >
                                                    <Settings className="h-5 w-5" />
                                                </Link>
                                            </Button>
                                        )}
                                        {circle._id && user && (
                                            <NotificationSettingsDialog
                                                entityType="CIRCLE"
                                                entityId={circle._id.toString()}
                                                className="ml-1"
                                            />
                                        )}
                                    </div>
                                )}
                            </div>

                            {isCompact && !isUser && (
                                <div className="flex w-full flex-wrap items-center justify-center gap-2 pb-2 pt-3">
                                    {user && circle.circleType === "circle" && isMember && (
                                        <ChatButton circle={circle} />
                                    )}
                                    {!isPeerifyManagedArtistIdentity && <InviteButton circle={circle} />}
                                    {user && <FollowButton circle={circle} />}
                                    {user && <BookmarkButton circle={circle} iconOnly />}
                                    {showSettingsButton && (
                                        <Button
                                            asChild
                                            variant="outline"
                                            size="icon"
                                            className={settingsButtonClassName}
                                        >
                                            <Link
                                                href={`/circles/${circle.handle}/settings/about`}
                                                aria-label={`Open ${circle.name ?? "circle"} settings`}
                                                title={settingsButtonTitle}
                                            >
                                                <Settings className="h-5 w-5" />
                                            </Link>
                                        </Button>
                                    )}
                                    {circle._id && user && (
                                        <NotificationSettingsDialog
                                            entityType="CIRCLE"
                                            entityId={circle._id.toString()}
                                            className="h-8 w-8 p-0"
                                        />
                                    )}
                                </div>
                            )}

                            {!isKamooniRootCircle && parentCircle && !isPeerifyManagedArtistIdentity && (
                                <div className="mt-3">
                                    {resolvedCircleLevel === "profile_child" ? (
                                        <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                            <span className="font-medium">Child of</span>
                                            <Link
                                                href={`/circles/${parentCircle.handle}`}
                                                className="font-semibold text-gray-900 hover:underline"
                                            >
                                                {parentCircle.name}
                                            </Link>
                                        </div>
                                    ) : (
                                        <div className="text-sm text-gray-500">
                                            Child circle of{" "}
                                            <Link
                                                href={`/circles/${parentCircle.handle}`}
                                                className="textLink hover:underline"
                                            >
                                                {parentCircle.name}
                                            </Link>
                                        </div>
                                    )}
                                </div>
                            )}
                            {/* Hidden for personal profiles: verification is now automatic once a profile
                                picture and About text are both set (see updateCircle in src/lib/data/circle.ts),
                                so the manual request-verification flow no longer applies here. Not deleted in
                                case manual verification is reintroduced.
                            {isOwnUserProfile && !isPeerifyArtistProfile ? (
                                <div className="flex items-center gap-2 pt-1">
                                    <VerifyAccountButton />
                                </div>
                            ) : null} */}
                            {(circle.description || circle.mission) && (
                                <div className="line-clamp-1 pb-1 text-gray-600">
                                    {authorizedToEdit ? (
                                        <EditableField
                                            id={isUser || circle.description ? "description" : "mission"}
                                            value={(circle.description || circle.mission)!}
                                            circleId={circle._id!}
                                            multiline
                                        />
                                    ) : (
                                        (circle.description ?? circle.mission)
                                    )}
                                </div>
                            )}
                            {isPeerifyArtistProfile && (
                                <div
                                    className={`flex w-full flex-col gap-3 ${isCompact ? "items-center" : "items-start"} py-2`}
                                >
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => openPeerifyArtistEnquiry("pledge")}
                                        >
                                            Pledge Interest
                                        </Button>
                                        {showPledgesDashboardButton ? (
                                            <Button asChild size="sm" variant="outline">
                                                <Link href={`/circles/${circle.handle}/settings/pledges`}>
                                                    <BarChart3 className="mr-2 h-4 w-4" />
                                                    Pledges
                                                </Link>
                                            </Button>
                                        ) : null}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {peerifyArtistProfile.primaryGenres.map((genre) => (
                                            <Badge
                                                key={genre}
                                                className="rounded-full bg-primary px-3 py-1 text-primary-foreground"
                                            >
                                                {formatPrimaryGenreLabel(genre, peerifyArtistProfile.primaryGenreOther)}
                                            </Badge>
                                        ))}
                                        {peerifyArtistProfile.genres.slice(0, 4).map((genre) => (
                                            <Badge key={genre} className="rounded-full px-3 py-1">
                                                {genre}
                                            </Badge>
                                        ))}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
                                        <Link
                                            href={`/circles/${circle.handle}/followers`}
                                            className="inline-flex items-center gap-2 transition-opacity hover:opacity-70 hover:underline"
                                        >
                                            <FaUsers />
                                            <span>
                                                {memberCount} {memberCount === 1 ? "Follower" : "Followers"}
                                            </span>
                                        </Link>
                                    </div>
                                    {!peerifyArtistProfile.bookingEnabled && (
                                        <div className="text-xs text-muted-foreground">
                                            Booking enquiries are not enabled on this profile yet.
                                        </div>
                                    )}
                                </div>
                            )}
                            {!isUser && !isPeerifyArtistProfile && memberCount > 0 && (
                                <Link
                                    href={`/circles/${circle.handle}/followers`}
                                    className="flex flex-row items-center justify-center text-gray-600 transition-opacity hover:opacity-70 hover:underline"
                                >
                                    <FaUsers />
                                    <p className="m-0 ml-2">
                                        {memberCount} {memberCount !== 1 ? "Followers" : "Follower"}
                                    </p>
                                </Link>
                            )}
                            {isCompact && (
                                <div className="pb-2 pt-2">
                                    <SocialLinks circle={circle} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
