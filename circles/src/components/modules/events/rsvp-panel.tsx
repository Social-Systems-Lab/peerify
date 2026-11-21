"use client";

import React from "react";
import Link from "next/link";
import { TbMessage } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { formatEventPlacesLeft } from "@/lib/events/guest-capacity";
import type { EventDisplay, Location } from "@/models/models";

// The RSVP box on an event (event guests, part 2, 2026-11-20), the same in the event page and the
// popup. On top of Attend / Interested / Cancel:
// - "N tickets left" / "Sold out" (or places / Full) from the capacity and the confirmed count (D5);
// - when full, Attend becomes "Join the waiting list", and a guest who isn't confirmed reads as on
//   the waiting list (D8);
// - a confirmed guest sees "You're confirmed" and no Cancel or Interested (D4);
// - the note for confirmed guests and, for an address revealed after acceptance, the address (D7):
//   to confirmed guests and organisers only. Someone who clicked Attend and isn't confirmed is
//   told details come once they are (decision B wording, as on shifts).

export const GUEST_DETAILS_AFTER_CONFIRMATION = "Details for guests appear once you're confirmed.";
// Next to the "Message the organisers" button (2026-11-21), which opens the DM only when pressed.
export const CONFIRMED_CONTACT_ORGANISERS = "To cancel, message the organisers.";

export type GuestDetailsForPanel = {
    isConfirmed: boolean;
    guestNote?: string;
    location?: Location;
    detailsAfterConfirmation: boolean;
};

type Props = {
    event: Pick<EventDisplay, "attendees" | "capacity" | "confirmedGuests" | "metadata" | "userRsvpStatus">;
    size: "compact" | "full";
    signedIn: boolean;
    signInHref: string;
    accessBadgeLabel?: string;
    isPending: boolean;
    // The viewer organises this event: they see the note labelled as what guests will see.
    isOrganiser?: boolean;
    guestDetails?: GuestDetailsForPanel | null;
    onAttend: () => void;
    onInterested: () => void;
    onCancel: () => void;
    // A confirmed guest's "Message the organisers" button. No button without it.
    onMessageOrganisers?: () => void;
};

const formatAddress = (location: Location) =>
    [location.street, location.city, location.region, location.country].filter(Boolean).join(", ");

export function GuestDetailsBox({
    guestDetails,
    isOrganiser,
    size,
}: {
    guestDetails?: GuestDetailsForPanel | null;
    isOrganiser?: boolean;
    size: "compact" | "full";
}) {
    if (!guestDetails) return null;
    const text = size === "compact" ? "text-xs" : "text-sm";
    const { guestNote, location } = guestDetails;
    if (guestNote || location) {
        return (
            <div className={`mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 ${text} text-emerald-950`}>
                <div className="mb-1 font-medium">
                    {isOrganiser && !guestDetails.isConfirmed ? "Note for confirmed guests" : "For guests"}
                </div>
                {location && <p className="m-0">Address: {formatAddress(location)}</p>}
                {guestNote && <p className="m-0 whitespace-pre-wrap">{guestNote}</p>}
                {isOrganiser && !guestDetails.isConfirmed && (
                    <p className="mb-0 mt-1 text-xs text-emerald-800">
                        Only confirmed guests and the organisers see this.
                    </p>
                )}
            </div>
        );
    }
    if (guestDetails.detailsAfterConfirmation) {
        return <div className={`mt-2 ${text} text-muted-foreground`}>{GUEST_DETAILS_AFTER_CONFIRMATION}</div>;
    }
    return null;
}

export default function RsvpPanel({
    event,
    size,
    signedIn,
    signInHref,
    accessBadgeLabel,
    isPending,
    isOrganiser,
    guestDetails,
    onAttend,
    onInterested,
    onCancel,
    onMessageOrganisers,
}: Props) {
    const text = size === "compact" ? "text-xs" : "text-sm";
    const placesLeft = formatEventPlacesLeft(event);
    const isConfirmed = !!guestDetails?.isConfirmed;
    const status = event.userRsvpStatus;
    const statusText =
        status === "going"
            ? isConfirmed
                ? "confirmed"
                : placesLeft?.full
                  ? "on the waiting list"
                  : "attending"
            : status;

    return (
        <>
            <div
                className={
                    size === "compact"
                        ? "mb-2 text-xs text-muted-foreground"
                        : "mb-2 text-sm font-medium text-muted-foreground"
                }
            >
                RSVP
            </div>
            {accessBadgeLabel && (
                <div
                    className={`${size === "compact" ? "mb-2" : "mb-3"} w-fit rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-medium text-stone-700`}
                >
                    {accessBadgeLabel}
                </div>
            )}
            {signedIn ? (
                isConfirmed && status === "going" ? (
                    <div className={text}>
                        <p className="m-0 font-medium text-emerald-800">You&apos;re confirmed.</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-muted-foreground">{CONFIRMED_CONTACT_ORGANISERS}</span>
                            {onMessageOrganisers && (
                                <Button size="sm" variant="outline" disabled={isPending} onClick={onMessageOrganisers}>
                                    <TbMessage className="mr-1 h-4 w-4" />
                                    Message the organisers
                                </Button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {status === "going" ? (
                            <>
                                <Button size="sm" variant="destructive" disabled={isPending} onClick={onCancel}>
                                    Cancel RSVP
                                </Button>
                                <Button size="sm" variant="outline" disabled={isPending} onClick={onInterested}>
                                    Interested
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button size="sm" disabled={isPending} onClick={onAttend}>
                                    {placesLeft?.full ? "Join the waiting list" : "Attend"}
                                </Button>
                                <Button size="sm" variant="outline" disabled={isPending} onClick={onInterested}>
                                    Interested
                                </Button>
                                {status && status !== "none" && (
                                    <Button size="sm" variant="destructive" disabled={isPending} onClick={onCancel}>
                                        Cancel RSVP
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                )
            ) : (
                <div className={`${text} text-muted-foreground`}>
                    <Link href={signInHref} className="underline">
                        Sign in to RSVP
                    </Link>
                    .
                </div>
            )}
            <div className={`${size === "compact" ? "mt-2" : "mt-3"} ${text} text-muted-foreground`}>
                Attendees (going): {event.attendees ?? 0}
                {placesLeft && (
                    <span className={placesLeft.full ? "font-medium text-foreground" : undefined}>
                        {" · "}
                        {placesLeft.text}
                    </span>
                )}
            </div>
            {signedIn && status && status !== "none" && <div className={`mt-1 ${text}`}>Your status: {statusText}</div>}
            <GuestDetailsBox guestDetails={guestDetails} isOrganiser={isOrganiser} size={size} />
        </>
    );
}
