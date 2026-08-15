"use client";

import React, { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    getEventArtistsAction,
    removeArtistFromEvent,
    removeSelfAsEventArtist,
    setArtistAdminStatus,
} from "@/app/circles/[handle]/events/actions";
import type { EventArtistBand } from "@/app/circles/[handle]/events/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

type Props = {
    circleHandle: string;
    eventId: string;
    additionalArtistCircleIds?: string[];
    // True host-level edit rights (event author or circle moderator) — deliberately NOT the
    // broader event canEdit flag, which also includes delegated artist admins. Delegated admins
    // must not get moderator-style controls over OTHER bands; per-band self-removal below is
    // evaluated independently of this.
    canManageAllArtists?: boolean;
    canRemoveSelfAsArtist?: boolean;
};

export default function EventArtistList({
    circleHandle,
    eventId,
    additionalArtistCircleIds,
    canManageAllArtists,
    canRemoveSelfAsArtist,
}: Props) {
    const [bands, setBands] = useState<EventArtistBand[]>([]);
    const [loading, setLoading] = useState(true);
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();
    const router = useRouter();
    const artistIdsKey = (additionalArtistCircleIds || []).join(",");

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        (async () => {
            const result = await getEventArtistsAction(circleHandle, eventId);
            if (!cancelled) {
                setBands(result.bands);
                setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [circleHandle, eventId, artistIdsKey]);

    if (loading || bands.length === 0) {
        return null;
    }

    const runAction = (action: () => Promise<{ success: boolean; message?: string }>) => {
        startTransition(async () => {
            const res = await action();
            if (res.success) {
                router.refresh();
            } else {
                toast({ title: "Error", description: res.message || "Something went wrong", variant: "destructive" });
            }
        });
    };

    return (
        <div className="rounded-md border p-4">
            <div className="mb-2 text-sm text-muted-foreground">Artists</div>
            <div className="space-y-3">
                {bands.map((band) => {
                    // Evaluated per band, independently of each other — a delegated admin of a
                    // DIFFERENT band on this event has canManageAllArtists=false here (that flag
                    // reflects only true author/moderator rights), and canSelfRemove doesn't care
                    // about the user's overall event permissions at all, only this specific band.
                    // Delegation does NOT block self-removal: removeSelfAsEventArtist already clears
                    // both additionalArtistCircleIds and artistAdminCircleIds for this circleId, and
                    // without this, a delegated band's own admin (who isn't also the host author or
                    // moderator) had no way to remove their band at all — canManageAllArtists was
                    // false for them, and the old `!band.isAdminDelegated` check hid this button too.
                    const canSelfRemove = !!canRemoveSelfAsArtist && band.currentUserIsAdmin;

                    return (
                        <div key={band.circle._id} className="flex flex-wrap items-center justify-between gap-3">
                            <Link
                                href={`/circles/${band.circle.handle}`}
                                className="flex items-center gap-3 hover:underline"
                            >
                                <Avatar>
                                    <AvatarImage src={band.circle.picture?.url} />
                                    <AvatarFallback>{band.circle.name?.[0]}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <p className="font-semibold">{band.circle.name}</p>
                                    <p className="text-sm text-muted-foreground">@{band.circle.handle}</p>
                                </div>
                            </Link>

                            {canManageAllArtists ? (
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            id={`artist-admin-toggle-${band.circle._id}`}
                                            checked={band.isAdminDelegated}
                                            disabled={isPending}
                                            onCheckedChange={(checked) =>
                                                runAction(() =>
                                                    setArtistAdminStatus(
                                                        circleHandle,
                                                        eventId,
                                                        band.circle._id!,
                                                        checked,
                                                    ),
                                                )
                                            }
                                        />
                                        <Label htmlFor={`artist-admin-toggle-${band.circle._id}`} className="text-xs">
                                            Edit access
                                        </Label>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={isPending}
                                        onClick={() =>
                                            runAction(() =>
                                                removeArtistFromEvent(circleHandle, eventId, band.circle._id!),
                                            )
                                        }
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ) : (
                                canSelfRemove && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={isPending}
                                        onClick={() =>
                                            runAction(() =>
                                                removeSelfAsEventArtist(circleHandle, eventId, band.circle._id!),
                                            )
                                        }
                                    >
                                        Remove yourself
                                    </Button>
                                )
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
