"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { useSetAtom } from "jotai";
import { TbMessage } from "react-icons/tb";
import { Circle } from "@/models/models";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    confirmEventGuestAction,
    getEventGuestsAction,
    unconfirmEventGuestAction,
    type EventGuestsResult,
} from "@/app/circles/[handle]/events/actions";
import { useToast } from "@/components/ui/use-toast";
import { contentPreviewAtom } from "@/lib/data/atoms";
import MessageGuestDialog from "./message-guest-dialog";

// An event's guest list (event guests, part 1, 2026-11-20): everyone who clicked Attend or
// Interested, for the event's organisers only (canSeeEventGuests: the creator, platform admins and
// "See and manage guests", admins and moderators by default). Each row has a Message button that
// starts a DM from the organiser's own profile. Everyone else sees nothing here: their own reply
// already shows in the RSVP box, and the public sees the count.
// Part 2: organisers confirm people who clicked Attend (e.g. paid), up to the event's capacity, and
// can undo a confirmation. Interested people can be messaged, not confirmed (D8).

export const GUESTS_NEED_PROFILE_TEXT =
    "To see who's coming, complete your profile: a picture, a short About text and the Community Guidelines.";

type Guest = EventGuestsResult["guests"][number];

type ViewProps = {
    result: EventGuestsResult;
    viewerDid?: string;
    onMessage: (guest: Circle) => void;
    onOpenProfile: (guest: Circle) => void;
    onConfirm?: (guestDid: string) => void;
    onUnconfirm?: (guestDid: string) => void;
    // The guest whose confirmation is being saved, if any.
    busyDid?: string | null;
};

type RowActions = Omit<ViewProps, "result"> & { allConfirmed: boolean };

export const confirmedSummary = (confirmedCount: number, capacity?: number) =>
    typeof capacity === "number" ? `${confirmedCount} of ${capacity} confirmed` : `${confirmedCount} confirmed`;

const formatSince = (since?: Date | string) => (since ? format(new Date(since), "d MMM yyyy") : null);

function GuestRow({
    guest,
    viewerDid,
    onMessage,
    onOpenProfile,
    onConfirm,
    onUnconfirm,
    busyDid,
    allConfirmed,
}: { guest: Guest } & RowActions) {
    const { user, message, since, confirmed } = guest;
    const busy = !!busyDid && busyDid === user.did;
    const sinceText = formatSince(since);
    // Stacked, so it fits the event page's narrow right column and a phone (2026-11-21): the person
    // on the first line, their note below, then the buttons on their own line.
    return (
        <li className="flex min-w-0 flex-col gap-1 rounded-md p-1">
            <button
                type="button"
                onClick={() => onOpenProfile(user)}
                className="flex min-w-0 items-center gap-2 text-left hover:opacity-80"
            >
                <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={user.picture?.url} />
                    <AvatarFallback>{user.name?.[0]}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 truncate font-semibold">{user.name}</span>
                {user.handle ? (
                    <span className="min-w-0 shrink truncate text-xs text-muted-foreground">@{user.handle}</span>
                ) : null}
                {confirmed ? (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        Confirmed
                    </span>
                ) : null}
            </button>
            {message ? <p className="m-0 break-words text-sm italic text-muted-foreground">“{message}”</p> : null}
            <div className="flex flex-wrap items-center gap-2">
                {guest.status === "going" && user.did && onConfirm && onUnconfirm ? (
                    confirmed ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => onUnconfirm(user.did!)}
                        >
                            Undo
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            size="sm"
                            disabled={busy || allConfirmed}
                            title={allConfirmed ? "All places are confirmed" : undefined}
                            onClick={() => onConfirm(user.did!)}
                        >
                            Confirm
                        </Button>
                    )
                ) : null}
                {user.did && user.did !== viewerDid ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => onMessage(user)}>
                        <TbMessage className="mr-1 h-4 w-4" />
                        Message
                    </Button>
                ) : null}
                {sinceText ? (
                    <span className="ml-auto text-xs text-muted-foreground">{`since ${sinceText}`}</span>
                ) : null}
            </div>
        </li>
    );
}

function GuestGroup({ title, guests, ...rowProps }: { title: string; guests: Guest[] } & RowActions) {
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
    const confirmedCount = result.confirmedCount ?? result.guests.filter((guest) => guest.confirmed).length;
    const allConfirmed = typeof result.capacity === "number" && confirmedCount >= result.capacity;
    return (
        <div className="rounded-md border p-4">
            <div className="mb-1 font-semibold">Guests</div>
            <p className="mb-3 mt-0 text-xs text-muted-foreground">
                Only the organisers see this list. {confirmedSummary(confirmedCount, result.capacity)}
                {allConfirmed ? " (all places)" : ""}.
            </p>
            <div className="space-y-4">
                <GuestGroup title="Attending" guests={attending} allConfirmed={allConfirmed} {...rowProps} />
                <GuestGroup title="Interested" guests={interested} allConfirmed={allConfirmed} {...rowProps} />
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
    const [busyDid, setBusyDid] = useState<string | null>(null);
    const setContentPreview = useSetAtom(contentPreviewAtom);
    const router = useRouter();
    const { toast } = useToast();

    const load = useCallback(async () => {
        try {
            setResult(await getEventGuestsAction(circleHandle, eventId));
        } catch (error) {
            console.error("Failed to load event guests:", error);
        }
    }, [circleHandle, eventId]);

    useEffect(() => {
        void load();
    }, [load, viewerDid]);

    const changeConfirmation = async (guestDid: string, confirm: boolean) => {
        setBusyDid(guestDid);
        try {
            const res = confirm
                ? await confirmEventGuestAction(circleHandle, eventId, guestDid)
                : await unconfirmEventGuestAction(circleHandle, eventId, guestDid);
            if (!res.success) {
                toast({ title: "Not saved", description: res.message, variant: "destructive" });
            }
            await load();
            // The page's "N tickets left" comes with the event.
            router.refresh();
        } finally {
            setBusyDid(null);
        }
    };

    if (!result) return null;

    return (
        <>
            <EventGuestListView
                result={result}
                viewerDid={viewerDid}
                onMessage={setMessaging}
                onOpenProfile={(guest) => setContentPreview({ type: "user", content: guest })}
                onConfirm={(guestDid) => changeConfirmation(guestDid, true)}
                onUnconfirm={(guestDid) => changeConfirmation(guestDid, false)}
                busyDid={busyDid}
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
