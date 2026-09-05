// crew-offer-map-preview.tsx
"use client";

import React from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { Circle } from "@/models/models";
import { Badge } from "@/components/ui/badge";
import { CirclePicture } from "@/components/modules/circles/circle-picture";
import { getTourTeamOfferingIcon, getTourTeamOfferingLabel } from "@/lib/data/tour-team-offerings";
import { getFullLocationName } from "@/lib/utils";

type CrewOfferMapPreviewProps = {
    circle: Circle;
};

// Deliberately separate from CirclePreview (content-preview.tsx) rather than a new branch on it —
// CirclePreview's Offers section is gated behind viewerIsOwnProfile/isViewerCircleAdmin (see the
// privacy-fix commits from the prior session), since a *generic* profile preview must never leak
// Crew Offers to the public. This component is the intended, deliberate public-facing surface for
// the shape getCrewOfferMapCircles already returns — {id, type, label} only, no detail or
// accommodationType, trimmed server-side for every viewer alike — so there is nothing left to
// gate here; it's safe to render unconditionally to whoever clicked the pin.
export default function CrewOfferMapPreview({ circle }: CrewOfferMapPreviewProps) {
    const offerings = circle.tourTeamOfferings ?? [];
    const locationLabel = getFullLocationName(circle.location);

    return (
        <div className="custom-scrollbar h-full overflow-y-auto p-4">
            <div className="flex items-center gap-3">
                <CirclePicture circle={circle} size="56px" />
                <div className="min-w-0">
                    <div className="truncate text-lg font-semibold">{circle.name || "Untitled"}</div>
                    {locationLabel && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{locationLabel}</span>
                        </div>
                    )}
                </div>
            </div>

            {offerings.length > 0 && (
                <div className="mt-4">
                    <h3 className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Crew Offers</h3>
                    <div className="flex flex-wrap items-center gap-2">
                        {offerings.map((offering) => {
                            const OfferingIcon = getTourTeamOfferingIcon(offering);
                            return (
                                <Badge key={offering.id} variant="outline" className="gap-1">
                                    <OfferingIcon className="h-3 w-3" />
                                    {getTourTeamOfferingLabel(offering)}
                                </Badge>
                            );
                        })}
                    </div>
                </div>
            )}

            {circle.handle && (
                <div className="mt-4">
                    <Link href={`/circles/${circle.handle}`} className="text-sm font-medium text-primary hover:underline">
                        View profile
                    </Link>
                </div>
            )}
        </div>
    );
}
