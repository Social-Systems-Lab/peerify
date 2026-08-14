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
    canEdit?: boolean;
    canRemoveSelfAsArtist?: boolean;
};

export default function EventArtistList({
    circleHandle,
    eventId,
    additionalArtistCircleIds,
    canEdit,
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
                {bands.map((band) => (
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

                        {canEdit ? (
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        id={`artist-admin-toggle-${band.circle._id}`}
                                        checked={band.isAdminDelegated}
                                        disabled={isPending}
                                        onCheckedChange={(checked) =>
                                            runAction(() =>
                                                setArtistAdminStatus(circleHandle, eventId, band.circle._id!, checked),
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
                            canRemoveSelfAsArtist &&
                            band.currentUserIsAdmin &&
                            !band.isAdminDelegated && (
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
                ))}
            </div>
        </div>
    );
}
