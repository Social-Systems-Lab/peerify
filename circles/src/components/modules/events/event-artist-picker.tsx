"use client";

import React, { useEffect, useState } from "react";
import { Circle } from "@/models/models";
import { searchArtistCirclesAction } from "@/app/circles/[handle]/events/actions";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export type SelectedArtistBand = {
    circleId: string;
    circle?: Circle;
    isAdminDelegated: boolean;
};

type Props = {
    value: SelectedArtistBand[];
    onChange: (bands: SelectedArtistBand[]) => void;
};

export default function EventArtistPicker({ value, onChange }: Props) {
    const [search, setSearch] = useState("");
    const [results, setResults] = useState<Circle[]>([]);

    useEffect(() => {
        if (!search.trim()) {
            setResults([]);
            return;
        }

        let cancelled = false;
        const debounce = setTimeout(async () => {
            const { circles } = await searchArtistCirclesAction(search, 15);
            if (!cancelled) {
                setResults(circles);
            }
        }, 300);

        return () => {
            cancelled = true;
            clearTimeout(debounce);
        };
    }, [search]);

    const selectedIds = new Set(value.map((band) => band.circleId));

    const addBand = (circle: Circle) => {
        if (!circle._id || selectedIds.has(circle._id)) return;
        onChange([...value, { circleId: circle._id, circle, isAdminDelegated: false }]);
        setSearch("");
        setResults([]);
    };

    const removeBand = (circleId: string) => {
        onChange(value.filter((band) => band.circleId !== circleId));
    };

    const setAdminDelegated = (circleId: string, isAdminDelegated: boolean) => {
        onChange(value.map((band) => (band.circleId === circleId ? { ...band, isAdminDelegated } : band)));
    };

    return (
        <div className="space-y-3">
            <Label htmlFor="artist-search">Additional artists / bands (optional)</Label>
            <Input
                id="artist-search"
                placeholder="Search for a band, artist, DJ, or producer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />
            {results.filter((circle) => circle._id && !selectedIds.has(circle._id)).length > 0 && (
                <div className="space-y-1 rounded-md border p-2">
                    {results
                        .filter((circle) => circle._id && !selectedIds.has(circle._id))
                        .map((circle) => (
                            <div
                                key={circle._id}
                                className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted"
                                onClick={() => addBand(circle)}
                            >
                                <Avatar className="h-8 w-8">
                                    <AvatarImage src={circle.picture?.url} />
                                    <AvatarFallback>{circle.name?.[0]}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <p className="text-sm font-medium">{circle.name}</p>
                                    <p className="text-xs text-muted-foreground">@{circle.handle}</p>
                                </div>
                            </div>
                        ))}
                </div>
            )}

            {value.length > 0 && (
                <div className="space-y-2">
                    {value.map((band) => (
                        <div key={band.circleId} className="flex flex-wrap items-center gap-3 rounded-md border p-2">
                            <Avatar className="h-8 w-8">
                                <AvatarImage src={band.circle?.picture?.url} />
                                <AvatarFallback>{band.circle?.name?.[0] || "?"}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-[120px] flex-1">
                                <p className="text-sm font-medium">{band.circle?.name || band.circleId}</p>
                                {band.circle?.handle && (
                                    <p className="text-xs text-muted-foreground">@{band.circle.handle}</p>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch
                                    id={`artist-admin-${band.circleId}`}
                                    checked={band.isAdminDelegated}
                                    onCheckedChange={(checked) => setAdminDelegated(band.circleId, checked)}
                                />
                                <Label htmlFor={`artist-admin-${band.circleId}`} className="text-xs font-normal">
                                    Give this band&apos;s admins edit access to this event
                                </Label>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => removeBand(band.circleId)}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
