"use client";

import React, { useState, useTransition } from "react";
import { EventDisplay } from "@/models/models";
import { cn, haversineKm, getUserLocation } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
    rsvpEventAction,
    cancelRsvpAction,
    changeEventStageAction,
    hideCancelledEventAction,
    unhideCancelledEventAction,
    deleteEventAction,
    changeEventHostAction,
    getEventAction,
} from "@/app/circles/[handle]/events/actions";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import CircleSelector from "@/components/global-create/circle-selector";
import { creatableItemsList } from "@/components/global-create/global-create-dialog-content";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import ImageCarousel from "@/components/ui/image-carousel";
import { Calendar, MapPin, Clock, X, EyeOff, Eye } from "lucide-react";
import Link from "next/link";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { MapDisplay } from "@/components/map/map";
import type { Circle, Media } from "@/models/models";

const getDistanceString = (distance: number) => {
    if (distance < 1) {
        return `${Math.round(distance * 1000)} m`;
    }
    if (distance < 10) {
        return `${distance.toFixed(1)} km`;
    }
    if (distance < 100) {
        return `${(distance / 10).toFixed(1)} mil`;
    }
    return `${(distance / 10).toFixed(0)} mil`;
};
import InvitedUserList from "./invited-user-list";
import EventArtistList from "./event-artist-list";
import InviteModal from "./invite-modal";
import AttendeesList from "./attendees-list";
import RsvpDialog from "./rsvp-dialog";
import EventTasksPanel from "./event-tasks-panel";
import { getEventJoinState } from "./event-join-state";
import { getPeerifyEventDisclosureDisplay, getPeerifySafeEventLocationText } from "./peerify-event-disclosure-display";
import { EventTagBadgeList, getEventTagBadges } from "./event-tag-badges";
import { CommentSection } from "../feeds/CommentSection";
import RichText from "../feeds/RichText";
import { userAtom, mapboxKeyAtom, zoomContentAtom, triggerMapOpenAtom, contentPreviewAtom } from "@/lib/data/atoms";
import { useAtom } from "jotai";
import { formatFundingAmount } from "@/components/modules/funding/funding-shared";

type Props = {
    circle?: Circle;
    circleHandle: string;
    event: EventDisplay;
    canEdit?: boolean;
    canReview?: boolean;
    canModerate?: boolean;
    isAuthor?: boolean;
    canRemoveSelfAsArtist?: boolean;
    isPreview?: boolean;
    onOpen?: () => void;
    onClose?: () => void;
    // Forces every viewer-identity-dependent section (RSVP, comments, distance-from-you) into its
    // logged-out state regardless of who's actually viewing — used by the "Preview as a fan would
    // see it" page so a host previewing their own event doesn't see their own RSVP/comment
    // identity leak through. Permission props (canEdit/canModerate/etc.) already independently
    // control host-only actions; this only affects the anonymous-visitor-identity parts.
    previewAsAnonymous?: boolean;
    // Fired with the freshly re-fetched event after a successful RSVP change, in addition to the
    // contentPreviewAtom patch refreshOpenEventPreview already does — lets any other client-side
    // list holding its own stale copy of this event (e.g. MobileEventsPanel's local state) patch
    // itself in place instead of only refreshing the ContentPreview popup.
    onEventUpdated?: (updatedEvent: EventDisplay) => void;
};

function googleCalendarUrl(e: EventDisplay) {
    const formatGoogle = (d?: Date) => (d ? format(new Date(d), "yyyyMMdd'T'HHmmss") : "");
    const dates = `${formatGoogle(e.startAt as any)}/${formatGoogle(e.endAt as any)}`;
    const params = new URLSearchParams({
        action: "TEMPLATE",
        text: e.title || "Event",
        details: e.description || "",
        dates,
    });
    if (e.isVirtual && e.virtualUrl) {
        params.set("location", e.virtualUrl);
    } else if (e.location?.city) {
        params.set("location", e.location.city);
    }
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export default function EventDetail({
    circle,
    circleHandle,
    event,
    canEdit,
    canReview,
    canModerate,
    isPreview,
    onOpen, // Callback when opening the event
    onClose,
    isAuthor,
    canRemoveSelfAsArtist,
    previewAsAnonymous,
    onEventUpdated,
}: Props) {
    const { toast } = useToast();
    const [user, setUser] = useAtom(userAtom);
    // See Props.previewAsAnonymous — every RSVP/comment/distance section below reads this instead
    // of `user` directly, so the preview renders as a logged-out visitor would see it regardless
    // of who's actually logged in and previewing.
    const effectiveUser = previewAsAnonymous ? null : user;
    const [mapboxKey] = useAtom(mapboxKeyAtom);
    const [, setZoomContent] = useAtom(zoomContentAtom);
    const [, setTriggerOpen] = useAtom(triggerMapOpenAtom);
    const [, setContentPreview] = useAtom(contentPreviewAtom);
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [isInviteModalOpen, setInviteModalOpen] = useState(false);
    const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [isRsvpDialogOpen, setRsvpDialogOpen] = useState(false);
    const [isChangeHostDialogOpen, setChangeHostDialogOpen] = useState(false);
    const [newHostCircle, setNewHostCircle] = useState<Circle | null>(null);
    const [isChangingHost, setIsChangingHost] = useState(false);
    const eventItemDetail = creatableItemsList.find((item) => item.key === "event");
    const compact = !!isPreview;
    const [hideUpdating, setHideUpdating] = useState(false);
    const eventId = ((event as any)._id?.toString?.() || (event as any)._id || "") as string;
    const hiddenCancelledIds = effectiveUser?.hiddenCancelledEventIds || [];
    const isEventHidden = eventId ? hiddenCancelledIds.includes(eventId) : false;
    const canManageJoinLink = Boolean(canEdit || canModerate || isAuthor || effectiveUser?.did === event.createdBy);
    // True host-level rights only (not the broader canEdit, which also includes delegated artist
    // admins) — used to gate moderator-style controls in the Artists list per band.
    const canManageAllArtists = Boolean(canModerate || isAuthor);

    // Read-only display of the linked Noticeboard post's configured audience (set via event-form.tsx's
    // own audience dialog) — surfaced here so a host can catch an unintended "Followers-only" post at a
    // glance instead of having to reopen the edit dialog.
    const getNoticeboardAudienceLabel = () => {
        const groups = (event.userGroups ?? []).filter((g) => g !== "everyone");
        if (groups.length === 0) return "Everyone";
        return groups
            .map(
                (g) =>
                    circle?.userGroups?.find((ug) => ug.handle === g)?.name ||
                    g.charAt(0).toUpperCase() + g.slice(1),
            )
            .join(", ");
    };

    const start = event.startAt ? new Date(event.startAt as any) : null;
    const end = event.endAt ? new Date(event.endAt as any) : null;
    const isCancelled = event.stage === "cancelled";
    const joinState = getEventJoinState(event, {
        canManageMissingLink: canManageJoinLink,
        missingLinkLabel: compact ? "Missing link" : "Join link missing",
    });
    const disclosureDisplay = getPeerifyEventDisclosureDisplay(event);
    const hasDisclosureDetails =
        disclosureDisplay.detailBadges.length > 0 || Boolean(disclosureDisplay.publicLocationLabel);
    const accessBadge = disclosureDisplay.cardBadges.find((badge) => badge.key === "access");
    const hasEventTagBadges = getEventTagBadges(event.tags).length > 0;

    const locationText = event.isVirtual && event.virtualUrl ? "" : getPeerifySafeEventLocationText(event) || "";
    const locationLabel = event.isVirtual && !locationText ? "Virtual" : locationText;
    const hasMapLocation = Boolean(event.location?.lngLat);
    const resolvedDistance = hasMapLocation
        ? ((event as any).distance ??
          (event.location?.lngLat && effectiveUser
              ? haversineKm(event.location.lngLat, getUserLocation(effectiveUser))
              : undefined))
        : undefined;

    const handleAddressClick = () => {
        if (!eventId || !hasMapLocation) return;
        const params = new URLSearchParams({
            category: "events",
            panel: "events",
            focusEvent: eventId,
        });
        router.push(`/explore?${params.toString()}`);
    };

    // Improved date formatting
    const now = new Date();
    const sameYear = start && start.getFullYear() === now.getFullYear();
    const fmt = sameYear ? "EEE, MMM d p" : "EEE, MMM d, yyyy p";
    const startFmt = start ? format(start, fmt) : "";
    const endFmt = end ? format(end, fmt) : "";

    const images: Media[] =
        event.images && event.images.length > 0
            ? event.images
            : [
                  {
                      name: "Default Cover",
                      type: "image/png",
                      fileInfo: { url: "/images/default-cover.png" },
                  } as Media,
              ];

    // ContentPreview (map-explorer's event popup) holds its own `event` in a client-side atom
    // that router.refresh() doesn't touch, so RSVP changes made from that surface never show up
    // without a full reload unless we patch the atom ourselves. Mirrors refreshOpenIssuePreview /
    // refreshOpenTaskPreview in issue-detail.tsx / task-detail.tsx.
    const refreshOpenEventPreview = async () => {
        if (!isPreview) return;
        const updatedEvent = await getEventAction(circleHandle, (event as any)._id?.toString?.() || "");
        if (!updatedEvent) return;
        setContentPreview((currentPreview) => {
            if (
                currentPreview?.type !== "event" ||
                (currentPreview.content as any)._id?.toString?.() !== (updatedEvent as any)._id?.toString?.()
            ) {
                return currentPreview;
            }
            return { ...currentPreview, content: updatedEvent };
        });
        onEventUpdated?.(updatedEvent);
    };

    const onRsvp = (status: "going" | "interested" | "waitlist") => {
        startTransition(async () => {
            const res = await rsvpEventAction(circleHandle, (event as any)._id?.toString?.() || "", status);
            if (res.success) {
                toast({ title: "RSVP updated" });
                await refreshOpenEventPreview();
                router.refresh();
            } else {
                toast({ title: "Error", description: res.message || "Failed to RSVP", variant: "destructive" });
            }
        });
    };

    const onCancelRsvp = () => {
        startTransition(async () => {
            const res = await cancelRsvpAction(circleHandle, (event as any)._id?.toString?.() || "");
            if (res.success) {
                toast({ title: "RSVP cancelled" });
                await refreshOpenEventPreview();
                router.refresh();
            } else {
                toast({ title: "Error", description: res.message || "Failed to cancel RSVP", variant: "destructive" });
            }
        });
    };

    // Stage control handlers
    const onSubmitForReview = () => {
        startTransition(async () => {
            const res = await changeEventStageAction(circleHandle, (event as any)._id?.toString?.() || "", "review");
            if (res.success) {
                toast({ title: "Event submitted for review" });
                router.refresh();
            } else {
                toast({ title: "Error", description: res.message || "Failed to submit", variant: "destructive" });
            }
        });
    };

    const onOpenNow = () => {
        startTransition(async () => {
            const res = await changeEventStageAction(circleHandle, (event as any)._id?.toString?.() || "", "open");
            if (res.success) {
                toast({ title: "Event opened" });
                router.refresh();
            } else {
                toast({ title: "Error", description: res.message || "Failed to open", variant: "destructive" });
            }
        });
    };

    const onDeleteEvent = () => {
        startTransition(async () => {
            const res = await deleteEventAction(circleHandle, (event as any)._id?.toString?.() || "");
            setDeleteDialogOpen(false);
            if (res.success) {
                toast({ title: "Event deleted" });
                router.push(`/circles/${circleHandle}/events`);
                router.refresh();
            } else {
                toast({ title: "Error", description: res.message || "Failed to delete event", variant: "destructive" });
            }
        });
    };

    const onChangeHost = () => {
        if (!newHostCircle?.handle) return;
        setIsChangingHost(true);
        startTransition(async () => {
            const res = await changeEventHostAction(
                circleHandle,
                (event as any)._id?.toString?.() || "",
                newHostCircle.handle!,
            );
            setIsChangingHost(false);
            if (res.success || res.pending) {
                setChangeHostDialogOpen(false);
                setNewHostCircle(null);
            }
            if (res.success) {
                toast({ title: res.message || "Event host changed" });
                if (res.newCircleHandle) {
                    router.push(`/circles/${res.newCircleHandle}/events/${(event as any)._id?.toString?.() || ""}`);
                }
                router.refresh();
            } else if (res.pending) {
                toast({ title: "Approval requested", description: res.message });
            } else {
                toast({ title: "Error", description: res.message || "Failed to change event host", variant: "destructive" });
            }
        });
    };

    const onCancelEvent = () => {
        startTransition(async () => {
            const res = await changeEventStageAction(circleHandle, (event as any)._id?.toString?.() || "", "cancelled");
            if (res.success) {
                toast({ title: "Event cancelled" });
                router.refresh();
            } else {
                toast({ title: "Error", description: res.message || "Failed to cancel", variant: "destructive" });
            }
        });
    };

    const onToggleHidden = () => {
        if (!eventId) return;
        const currentlyHidden = isEventHidden;
        const action = currentlyHidden ? unhideCancelledEventAction : hideCancelledEventAction;
        setHideUpdating(true);
        action(circleHandle, eventId)
            .then((res) => {
                if (res.success) {
                    setUser((prev) => {
                        if (!prev) return prev;
                        const nextHidden = new Set(prev.hiddenCancelledEventIds || []);
                        if (currentlyHidden) {
                            nextHidden.delete(eventId);
                        } else {
                            nextHidden.add(eventId);
                        }
                        return { ...prev, hiddenCancelledEventIds: Array.from(nextHidden) };
                    });
                    toast({
                        title: currentlyHidden ? "Cancelled event restored" : "Cancelled event hidden",
                        description: currentlyHidden
                            ? "The event will appear again in your calendars."
                            : "This event will no longer appear in your calendars.",
                    });
                    router.refresh();
                } else {
                    toast({
                        title: "Unable to update event",
                        description: res.message || "Please try again.",
                        variant: "destructive",
                    });
                }
            })
            .catch((error) => {
                console.error("toggle hidden cancelled event failed:", error);
                toast({
                    title: "Unable to update event",
                    description: "Something went wrong. Please try again.",
                    variant: "destructive",
                });
            })
            .finally(() => setHideUpdating(false));
    };

    if (compact) {
        // Compact preview layout specialized for events
        return (
            <div className="space-y-3">
                <div className="relative h-[270px] w-full">
                    <ImageCarousel
                        images={images}
                        options={{ loop: images.length > 1 }}
                        containerClassName="h-full"
                        imageClassName="object-cover"
                        showArrows={false}
                        showDots={images.length > 1}
                        dotsPosition="bottom-right"
                    />
                    {onClose && (
                        <Button
                            size="icon"
                            variant="ghost"
                            className="absolute right-2 top-2 z-20 h-8 w-8 rounded-full bg-black/30 text-white hover:bg-black/50"
                            onClick={(e) => {
                                e.stopPropagation();
                                onClose();
                            }}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                    {start && (
                        <div className="absolute left-2 top-2 z-10 rounded-md bg-black/45 px-2 py-1 text-xs text-white md:text-sm">
                            {format(start, "MMM d")}
                        </div>
                    )}
                    {start && (
                        <div className="absolute bottom-2 left-2 z-10 rounded-md bg-black/45 px-2 py-1 text-xs text-white md:text-sm">
                            {event.allDay ? (
                                "All Day"
                            ) : (
                                <>
                                    {format(start, "p")}
                                    {end ? ` - ${format(end, "p")}` : ""}
                                </>
                            )}
                        </div>
                    )}

                    <a
                        className="absolute bottom-2 right-2 z-10"
                        href={googleCalendarUrl(event)}
                        target="_blank"
                        rel="noreferrer"
                    >
                        <Button
                            size="icon"
                            variant="ghost"
                            className="rounded-full bg-black/30 text-white hover:bg-black/50"
                        >
                            <Calendar className="h-4 w-4" />
                        </Button>
                    </a>
                </div>

                <div className="px-4">
                    <h1 className="text-xl font-semibold">{event.title}</h1>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        {/* {shortDateTimeRange && (
                            <span className="inline-flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                {shortDateTimeRange}
                            </span>
                        )} */}
                        {(locationText || event.isVirtual || event.isHybrid) && (
                            <div className="inline-flex items-center gap-1">
                                {event.location && event.location.lngLat ? (
                                    <HoverCard openDelay={0} closeDelay={0}>
                                        <HoverCardTrigger asChild>
                                            <button
                                                className="inline-flex items-center rounded-full border border-transparent bg-gray-100 px-2 py-0.5 transition-colors hover:border-gray-300 hover:bg-gray-200"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setZoomContent(event);
                                                    setTriggerOpen(true);
                                                }}
                                                title="Zoom to location"
                                            >
                                                <MapPin className="mr-1 h-3 w-3 text-primary" />
                                                <span className="max-w-[200px] truncate">
                                                    {event.isVirtual && !locationText ? "Virtual" : locationText}
                                                    {event.isHybrid ? " · Hybrid" : ""}
                                                </span>
                                            </button>
                                        </HoverCardTrigger>
                                        {resolvedDistance !== undefined &&
                                            resolvedDistance !== Number.POSITIVE_INFINITY && (
                                                <HoverCardContent className="w-auto p-2" side="top" align="center">
                                                    <div className="text-xs font-medium">
                                                        {getDistanceString(resolvedDistance)} from your location
                                                    </div>
                                                </HoverCardContent>
                                            )}
                                    </HoverCard>
                                ) : (
                                    <span>
                                        {event.isVirtual && !locationText ? "Virtual" : locationText}
                                        {event.isHybrid ? " · Hybrid" : ""}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                    {(disclosureDisplay.cardBadges.length > 0 || disclosureDisplay.publicLocationLabel) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {disclosureDisplay.publicLocationLabel && (
                                <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-medium text-stone-700">
                                    {disclosureDisplay.publicLocationLabel}
                                </span>
                            )}
                            {disclosureDisplay.cardBadges.map((badge) => (
                                <span
                                    key={badge.key}
                                    className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-700"
                                >
                                    {badge.label}
                                </span>
                            ))}
                        </div>
                    )}
                    <EventTagBadgeList
                        tags={event.tags}
                        className="mt-2 flex flex-wrap items-start gap-x-1.5 gap-y-2"
                        variant="tint"
                    />
                </div>

                <div className="px-4">
                    <div className="rounded-md border bg-white/60 p-3">
                        <div className="mb-2 text-xs text-muted-foreground">RSVP</div>
                        {accessBadge && (
                            <div className="mb-2 w-fit rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-medium text-stone-700">
                                {accessBadge.label}
                            </div>
                        )}
                        {effectiveUser ? (
                            <div className="flex flex-wrap gap-2">
                                {event.userRsvpStatus === "going" ? (
                                    <>
                                        <Button
                                            size="sm"
                                            variant="destructive"
                                            disabled={isPending}
                                            onClick={onCancelRsvp}
                                        >
                                            Cancel RSVP
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={isPending}
                                            onClick={() => onRsvp("interested")}
                                        >
                                            Interested
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Button size="sm" disabled={isPending} onClick={() => setRsvpDialogOpen(true)}>
                                            I&apos;m going
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={isPending}
                                            onClick={() => onRsvp("interested")}
                                        >
                                            Interested
                                        </Button>
                                        {event.userRsvpStatus && event.userRsvpStatus !== "none" && (
                                            <Button
                                                size="sm"
                                                variant="destructive"
                                                disabled={isPending}
                                                onClick={onCancelRsvp}
                                            >
                                                Cancel RSVP
                                            </Button>
                                        )}
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="text-xs text-muted-foreground">Sign in to RSVP.</div>
                        )}
                        <div className="mt-2 text-xs text-muted-foreground">
                            Attendees (going): {event.attendees ?? 0}
                        </div>
                        {effectiveUser && event.userRsvpStatus && event.userRsvpStatus !== "none" && (
                            <div className="mt-1 text-xs">Your status: {event.userRsvpStatus}</div>
                        )}
                    </div>
                </div>

                {event.description && (
                    <div className="px-4">
                        <div className="rounded-lg border bg-white/70 p-5 shadow-sm">
                            <div className="prose prose-sm max-w-none">
                                <RichText content={event.description} />
                            </div>
                        </div>
                    </div>
                )}

                <div className="px-4">
                    <Button
                        className="w-full hover:bg-gray-300"
                        variant="secondary"
                        onClick={() => {
                            if (onOpen) onOpen();
                            router.push(
                                `/circles/${circleHandle}/events/${(event as any)._id?.toString?.() || ""}#circle-tabs`,
                            );
                        }}
                    >
                        Open Event
                    </Button>
                </div>

                <InviteModal
                    circleHandle={circleHandle}
                    eventId={event._id!.toString()}
                    open={isInviteModalOpen}
                    onOpenChange={setInviteModalOpen}
                />
                <RsvpDialog
                    circleHandle={circleHandle}
                    eventId={event._id!.toString()}
                    open={isRsvpDialogOpen}
                    onOpenChange={setRsvpDialogOpen}
                    onSuccess={refreshOpenEventPreview}
                />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Cover image */}
            {event.images && event.images.length > 0 && (
                <div className="relative h-64 w-full md:h-80">
                    <ImageCarousel
                        images={images}
                        options={{ loop: images.length > 1 }}
                        containerClassName="h-full"
                        imageClassName="object-cover rounded-md"
                        showArrows={images.length > 1}
                        showDots={images.length > 1}
                        dotsPosition="bottom-right"
                    />
                    {event.stage === "draft" && (
                        <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-[#E8732C]/40 bg-[#FAF6EC]/95 px-3 py-1.5 shadow-sm backdrop-blur-sm">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#E8732C]" />
                            <span className="text-xs font-semibold uppercase tracking-wide text-[#1A1612]">
                                Draft — not visible to the public
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    {/* Happening now / upcoming label */}
                    {start && end && now >= start && now <= end && (
                        <div className="mb-1 text-sm font-medium text-green-600">Happening now</div>
                    )}
                    {start && now < start && <div className="mb-1 text-sm font-medium text-blue-600">Upcoming</div>}
                    <h1 className="text-3xl font-bold tracking-tight">{event.title}</h1>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        {startFmt && (
                            <span className="inline-flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                {endFmt ? `${startFmt} — ${endFmt}` : startFmt}
                            </span>
                        )}
                        {(locationText || event.isVirtual || event.isHybrid) &&
                            (hasMapLocation ? (
                                <HoverCard openDelay={0} closeDelay={0}>
                                    <HoverCardTrigger asChild>
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-1 rounded-full border border-transparent bg-gray-100 px-3 py-1 text-sm transition-colors hover:border-gray-300 hover:bg-gray-200"
                                            onClick={handleAddressClick}
                                        >
                                            <MapPin className="h-4 w-4 text-primary" />
                                            <span className="max-w-[220px] truncate text-left">
                                                {locationLabel}
                                                {event.isHybrid ? " · Hybrid" : ""}
                                            </span>
                                        </button>
                                    </HoverCardTrigger>
                                    {resolvedDistance !== undefined &&
                                        resolvedDistance !== Number.POSITIVE_INFINITY && (
                                            <HoverCardContent className="w-auto p-2" side="top" align="center">
                                                <div className="text-xs font-medium">
                                                    {getDistanceString(resolvedDistance)} from your location
                                                </div>
                                            </HoverCardContent>
                                        )}
                                </HoverCard>
                            ) : (
                                <span className="inline-flex items-center gap-1">
                                    <MapPin className="h-4 w-4" />
                                    {locationLabel}
                                    {event.isHybrid ? " · Hybrid" : ""}
                                </span>
                            ))}
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">
                        <Button variant="outline">Add to Google Calendar</Button>
                    </a>
                    {canEdit && (
                        <Button
                            variant="outline"
                            onClick={() =>
                                router.push(
                                    `/circles/${circleHandle}/events/${(event as any)._id?.toString?.() || ""}/edit`,
                                )
                            }
                        >
                            Edit
                        </Button>
                    )}
                    {event.stage === "open" && <Button onClick={() => setInviteModalOpen(true)}>Invite</Button>}
                </div>
            </div>

            {/* Event tags — placed right under the header (title/date/location), above Stage
                controls, so hosts and visitors see them immediately rather than having to scroll
                past When/Where/RSVP/Artists first. */}
            {hasEventTagBadges && (
                <EventTagBadgeList
                    tags={event.tags}
                    className="flex flex-wrap items-start gap-x-1.5 gap-y-2"
                    variant="tint"
                />
            )}

            {/* Stage controls — admin/author only. The block itself has no per-button relevance
                to a plain viewer (status text, noticeboard-audience text, and every action
                button below are all host/moderator concerns), so the whole card is gated here
                rather than relying on each button's own gate to make it look empty. */}
            {(canEdit || canModerate || canReview || isAuthor) && (
                <div
                    className={cn(
                        "flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 shadow-sm",
                        event.stage === "draft" ? "border-[#E8732C]/50 bg-[#F8E2CE]" : "bg-white/70",
                    )}
                >
                    <div className="flex flex-col gap-1">
                        {event.stage === "draft" ? (
                            <div className="flex items-center gap-2 text-sm text-[#1A1612]">
                                <EyeOff className="h-4 w-4 text-[#E8732C]" />
                                <span className="font-bold uppercase tracking-wide">
                                    Draft — not visible to the public
                                </span>
                            </div>
                        ) : (
                            <div className="text-sm text-muted-foreground">
                                Status: <span className="font-medium capitalize">{event.stage}</span>
                            </div>
                        )}
                        {event.publishToNoticeboard && (
                            <div className="text-xs text-muted-foreground">
                                Noticeboard post visible to:{" "}
                                <span className="font-medium">{getNoticeboardAudienceLabel()}</span>
                            </div>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {event.stage === "draft" && isAuthor && !canReview && (
                            <Button disabled={isPending} variant="secondary" onClick={onSubmitForReview}>
                                Submit for review
                            </Button>
                        )}
                        {(event.stage === "draft" || event.stage === "review") && canReview && (
                            <Button disabled={isPending} onClick={onOpenNow}>
                                Publish
                            </Button>
                        )}
                        {event.stage === "draft" && (isAuthor || canModerate) && (
                            <Button
                                disabled={isPending}
                                variant="destructive"
                                onClick={() => setDeleteDialogOpen(true)}
                            >
                                Delete
                            </Button>
                        )}
                        {/* Available regardless of stage — the /preview route itself has no
                            stage restriction (it forces stage: "open" on the sanitized render
                            either way), and admins can still edit a live event, so there's no
                            reason this should disappear once the event leaves Draft. */}
                        {(isAuthor || canModerate) && (
                            <Button variant="outline" asChild>
                                <Link
                                    href={`/circles/${circleHandle}/events/${(event as any)._id?.toString?.() || ""}/preview`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <Eye className="mr-2 h-4 w-4" />
                                    Preview as a fan would see it
                                </Link>
                            </Button>
                        )}
                        {isAuthor && (
                            <Button
                                variant="outline"
                                disabled={isPending}
                                onClick={() => setChangeHostDialogOpen(true)}
                            >
                                Change host
                            </Button>
                        )}
                        {event.stage === "open" && (canReview || canModerate) && (
                            <Button disabled={isPending} variant="destructive" onClick={onCancelEvent}>
                                Cancel
                            </Button>
                        )}
                        {(event.stage === "cancelled" || isEventHidden) && (
                            <Button variant="outline" disabled={hideUpdating} onClick={onToggleHidden}>
                                {hideUpdating ? "Updating…" : isEventHidden ? "Show again" : "Hide"}
                            </Button>
                        )}
                    </div>
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-3">
                <div className="space-y-6 md:col-span-2">
                    {event.description && (
                        <div className="rounded-lg border bg-white/70 p-5 shadow-sm">
                            <div className="prose max-w-none">
                                <RichText content={event.description} />
                            </div>
                        </div>
                    )}

                    {event.metadata?.peerify?.ticketed === true &&
                        typeof event.metadata?.peerify?.price === "number" && (
                            <div className="rounded-lg border bg-white/70 p-5 shadow-sm">
                                <div className="mb-2 text-sm font-medium text-muted-foreground">Price</div>
                                <div className="text-lg font-semibold">
                                    {formatFundingAmount(
                                        event.metadata.peerify.price,
                                        event.metadata.peerify.currency || "EUR",
                                    )}
                                </div>
                                {event.metadata.peerify.paymentInfo && (
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {event.metadata.peerify.paymentInfo}
                                    </p>
                                )}
                            </div>
                        )}
                </div>

                <div className="space-y-4">
                    <div className="rounded-lg border bg-white/70 p-5 shadow-sm">
                        <div className="mb-2 text-sm font-medium text-muted-foreground">RSVP</div>
                        {accessBadge && (
                            <div className="mb-3 w-fit rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-medium text-stone-700">
                                {accessBadge.label}
                            </div>
                        )}
                        {effectiveUser ? (
                            <div className="flex flex-wrap gap-2">
                                {event.userRsvpStatus === "going" ? (
                                    <>
                                        <Button
                                            size="sm"
                                            variant="destructive"
                                            disabled={isPending}
                                            onClick={onCancelRsvp}
                                        >
                                            Cancel RSVP
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={isPending}
                                            onClick={() => onRsvp("interested")}
                                        >
                                            Interested
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Button size="sm" disabled={isPending} onClick={() => setRsvpDialogOpen(true)}>
                                            I&apos;m going
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={isPending}
                                            onClick={() => onRsvp("interested")}
                                        >
                                            Interested
                                        </Button>
                                        {event.userRsvpStatus && event.userRsvpStatus !== "none" && (
                                            <Button
                                                size="sm"
                                                variant="destructive"
                                                disabled={isPending}
                                                onClick={onCancelRsvp}
                                            >
                                                Cancel RSVP
                                            </Button>
                                        )}
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="text-sm text-muted-foreground">Sign in to RSVP.</div>
                        )}
                        <div className="mt-3 text-sm text-muted-foreground">
                            Attendees (going): {event.attendees ?? 0}
                        </div>
                        {effectiveUser && event.userRsvpStatus && event.userRsvpStatus !== "none" && (
                            <div className="mt-1 text-sm">Your status: {event.userRsvpStatus}</div>
                        )}
                    </div>
                    <EventArtistList
                        circleHandle={circleHandle}
                        eventId={event._id!.toString()}
                        additionalArtistCircleIds={event.additionalArtistCircleIds}
                        artistAdminCircleIds={event.artistAdminCircleIds}
                        canManageAllArtists={canManageAllArtists}
                        canRemoveSelfAsArtist={canRemoveSelfAsArtist}
                    />
                    <AttendeesList circleHandle={circleHandle} eventId={event._id!.toString()} />
                    {event.invitations && event.invitations.length > 0 && (
                        <InvitedUserList
                            userDids={event.invitations}
                            circleHandle={circleHandle}
                            eventId={event._id!.toString()}
                        />
                    )}
                    <EventTasksPanel circleHandle={circleHandle} eventId={event._id!.toString()} />
                </div>
            </div>

            {/* When/Where — moved down here from the top of the page: for most events they just
                repeat what the compact header line under the title already shows, so they no
                longer need to interrupt the page before RSVP/Artists/Attendees/Tasks. Content and
                the Where card's disclosure-badge logic are unchanged, only the position moved. */}
            <div className="grid gap-6 md:grid-cols-2">
                <div className="rounded-lg border bg-white/70 p-5 shadow-sm">
                    <div className="mb-1 text-sm font-medium text-muted-foreground">When</div>
                    <div className="text-base font-semibold">
                        {startFmt}
                        {endFmt ? ` — ${endFmt}` : ""}
                        {event.allDay ? " (All day)" : ""}
                    </div>
                </div>

                <div className="rounded-lg border bg-white/70 p-5 shadow-sm">
                    <div className="mb-1 text-sm font-medium text-muted-foreground">Where</div>
                    <div className="text-base font-semibold">
                        {event.isVirtual ? (
                            <div className="flex flex-col gap-2">
                                {joinState ? (
                                    <span className="w-fit" title={joinState.title}>
                                        <Button
                                            type="button"
                                            variant={joinState.isEnabled ? "default" : "outline"}
                                            disabled={!joinState.isEnabled}
                                            className={cn(
                                                joinState.isEnabled && "bg-green-600 text-white hover:bg-green-700",
                                                !joinState.isEnabled &&
                                                    !joinState.isMissingLink &&
                                                    "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-100 disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-700 disabled:opacity-100",
                                                joinState.isMissingLink &&
                                                    "border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-100 disabled:border-amber-300 disabled:bg-amber-100 disabled:text-amber-900 disabled:opacity-100",
                                            )}
                                            onClick={() => {
                                                if (joinState.isEnabled && joinState.href) {
                                                    window.open(joinState.href, "_blank", "noopener,noreferrer");
                                                }
                                            }}
                                        >
                                            {joinState.label}
                                        </Button>
                                    </span>
                                ) : null}
                                {event.virtualUrl ? (
                                    <a
                                        className="break-all text-blue-600 underline"
                                        href={event.virtualUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        {event.virtualUrl}
                                    </a>
                                ) : (
                                    <div className="text-sm font-normal text-muted-foreground">
                                        Join link not added yet.
                                    </div>
                                )}
                            </div>
                        ) : event.location ? (
                            <>
                                {event.location.city || event.location.region || event.location.country
                                    ? [event.location.city, event.location.region, event.location.country]
                                          .filter(Boolean)
                                          .join(", ")
                                    : "Location provided"}
                            </>
                        ) : (
                            "Not specified"
                        )}
                        {event.isHybrid ? <div className="text-xs text-muted-foreground">Hybrid</div> : null}
                    </div>
                    {hasDisclosureDetails && (
                        <div className="mt-3 border-t pt-3">
                            {disclosureDisplay.publicLocationLabel && (
                                <div className="mb-2 text-sm font-medium text-stone-800">
                                    {disclosureDisplay.publicLocationLabel}
                                </div>
                            )}
                            <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                                Location privacy
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {disclosureDisplay.detailBadges.map((badge) => (
                                    <span
                                        key={badge.key}
                                        className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-medium text-stone-700"
                                    >
                                        {badge.label}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <InviteModal
                circleHandle={circleHandle}
                eventId={event._id!.toString()}
                open={isInviteModalOpen}
                onOpenChange={setInviteModalOpen}
            />
            <RsvpDialog
                circleHandle={circleHandle}
                eventId={event._id!.toString()}
                open={isRsvpDialogOpen}
                onOpenChange={setRsvpDialogOpen}
                onSuccess={refreshOpenEventPreview}
            />
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this draft event?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete &quot;{event.title}&quot;. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isPending}
                            onClick={onDeleteEvent}
                            className="bg-red-500 hover:bg-red-600"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog
                open={isChangeHostDialogOpen}
                onOpenChange={(open) => {
                    setChangeHostDialogOpen(open);
                    if (!open) setNewHostCircle(null);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Change event host</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Pick a new circle to host this event. If you administer that circle, the change happens
                        immediately. Otherwise, its admins will need to approve it first — RSVPs, comments, and tasks
                        stay exactly as they are either way.
                    </p>
                    {eventItemDetail && (
                        <CircleSelector
                            itemType={eventItemDetail}
                            onCircleSelected={setNewHostCircle}
                            label="New host:"
                        />
                    )}
                    <DialogFooter>
                        <Button
                            variant="outline"
                            disabled={isChangingHost}
                            onClick={() => setChangeHostDialogOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            disabled={isChangingHost || !newHostCircle || newHostCircle._id === circle?._id}
                            onClick={onChangeHost}
                        >
                            {isChangingHost ? "Changing..." : "Change host"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {event.commentPostId ? (
                <CommentSection postId={event.commentPostId} circle={circle!} user={effectiveUser ?? null} />
            ) : (
                <div className="text-sm text-gray-500">Comments are not available for this event.</div>
            )}
        </div>
    );
}
