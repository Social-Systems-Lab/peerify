"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useSetAtom } from "jotai";
import { TbMessage } from "react-icons/tb";
import { Circle } from "@/models/models";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getEventGuestsAction, type EventGuestsResult } from "@/app/circles/[handle]/events/actions";
import { contentPreviewAtom } from "@/lib/data/atoms";
import MessageGuestDialog from "./message-guest-dialog";

// An event's guest list (event guests, part 1, 2026-11-20): everyone who clicked Attend or
// Interested, for the event's organisers only (canSeeEventGuests: the creator, platform admins and
// "See and manage guests", admins and moderators by default). Each row has a Message button that
// starts a DM from the organiser's own profile. Everyone else sees nothing here: their own reply
// already shows in the RSVP box, and the public sees the count.

export const GUESTS_NEED_PROFILE_TEXT =
    "To see who's coming, complete your profile: a picture, a short About text and the Community Guidelines.";

type Guest = EventGuestsResult["guests"][number];

type ViewProps = {
    result: EventGuestsResult;
    viewerDid?: string;
    onMessage: (guest: Circle) => void;
    onOpenProfile: (guest: Circle) => void;
};

const formatSince = (since?: Date | string) => (since ? format(new Date(since), "d MMM yyyy") : null);

function GuestRow({
    guest,
    viewerDid,
    onMessage,
    onOpenProfile,
}: {
    guest: Guest;
    viewerDid?: string;
    onMessage: (guest: Circle) => void;
    onOpenProfile: (guest: Circle) => void;
}) {
    const { user, message, since } = guest;
    const sinceText = formatSince(since);
    return (
        <li className="flex items-start gap-3 rounded-md p-1">
            <button
                type="button"
                onClick={() => onOpenProfile(user)}
                className="flex min-w-0 flex-1 items-start gap-3 text-left hover:opacity-80"
            >
                <Avatar>
                    <AvatarImage src={user.picture?.url} />
                    <AvatarFallback>{user.name?.[0]}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                    <p className="m-0 truncate font-semibold">{user.name}</p>
                    <p className="m-0 text-xs text-muted-foreground">
                        {user.handle ? `@${user.handle}` : null}
                        {user.handle && sinceText ? " · " : null}
                        {sinceText ? `since ${sinceText}` : null}
                    </p>
                    {message ? <p className="mt-1 text-sm italic text-muted-foreground">“{message}”</p> : null}
                </div>
            </button>
            {user.did && user.did !== viewerDid ? (
                <Button type="button" size="sm" variant="outline" onClick={() => onMessage(user)}>
                    <TbMessage className="mr-1 h-4 w-4" />
                    Message
                </Button>
            ) : null}
        </li>
    );
}

function GuestGroup({ title, guests, ...rowProps }: { title: string; guests: Guest[] } & Omit<ViewProps, "result">) {
    return (
        <div>
            <div className="mb-1 text-sm font-medium">
                {title} ({guests.length})
            </div>
            {guests.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">Nobody yet.</p>
            ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                    {guests.map((guest) => (
                        <GuestRow key={guest.user.did} guest={guest} {...rowProps} />
                    ))}
                </ul>
            )}
        </div>
    );
}

export function EventGuestListView({ result, ...rowProps }: ViewProps) {
    if (result.needsProfileToSeeGuests) {
        return (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {GUESTS_NEED_PROFILE_TEXT}{" "}
                <Link href="/onboarding/pilot" className="font-medium underline">
                    Complete your profile
                </Link>
            </div>
        );
    }
    if (!result.canSeeGuests) return null;

    const attending = result.guests.filter((guest) => guest.status === "going");
    const interested = result.guests.filter((guest) => guest.status === "interested");
    return (
        <div className="rounded-md border p-4">
            <div className="mb-1 font-semibold">Guests</div>
            <p className="mb-3 mt-0 text-xs text-muted-foreground">Only the organisers see this list.</p>
            <div className="space-y-4">
                <GuestGroup title="Attending" guests={attending} {...rowProps} />
                <GuestGroup title="Interested" guests={interested} {...rowProps} />
            </div>
        </div>
    );
}

type Props = {
    circleHandle: string;
    // The circle hosting the event (event.circleId): the Message button's grant names it.
    circleId: string;
    eventId: string;
    viewerDid?: string;
};

export default function AttendeesList({ circleHandle, circleId, eventId, viewerDid }: Props) {
    const [result, setResult] = useState<EventGuestsResult | null>(null);
    const [messaging, setMessaging] = useState<Circle | null>(null);
    const setContentPreview = useSetAtom(contentPreviewAtom);

    useEffect(() => {
        let mounted = true;
        getEventGuestsAction(circleHandle, eventId)
            .then((loaded) => {
                if (mounted) setResult(loaded);
            })
            .catch((error) => console.error("Failed to load event guests:", error));
        return () => {
            mounted = false;
        };
    }, [circleHandle, eventId, viewerDid]);

    if (!result) return null;

    return (
        <>
            <EventGuestListView
                result={result}
                viewerDid={viewerDid}
                onMessage={setMessaging}
                onOpenProfile={(guest) => setContentPreview({ type: "user", content: guest })}
            />
            <MessageGuestDialog
                guest={messaging}
                circleId={circleId}
                eventId={eventId}
                onClose={() => setMessaging(null)}
            />
        </>
    );
}
