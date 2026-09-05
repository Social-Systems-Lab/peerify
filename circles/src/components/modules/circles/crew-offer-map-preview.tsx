// crew-offer-map-preview.tsx
"use client";

import React from "react";
import { MapPin } from "lucide-react";
import { OfferMapPin } from "@/models/models";
import { getFullLocationName } from "@/lib/utils";
import { getTourTeamOfferingIcon, getTourTeamOfferingLabel } from "@/lib/data/tour-team-offerings";

type CrewOfferMapPreviewProps = {
    pin: OfferMapPin;
};

// Deliberately separate from CirclePreview (content-preview.tsx) rather than a new branch on it —
// CirclePreview's Offers section is gated behind viewerIsOwnProfile/isViewerCircleAdmin (see the
// privacy-fix commits from a prior session), since a *generic* profile preview must never leak
// Crew Offers to the public. OfferMapPin (models.ts) carries zero identity of the offering circle
// at all — no did/name/handle/picture — consistent with offers being browsable before any
// Crew/artist relationship exists, and with the (not-yet-built) anonymized-contact-thread design
// where the host stays hidden until they choose to reply. There is nothing left to gate here: no
// name, no avatar/initials, no "View profile" link — just the offer type/label and its
// (already viewer-precision-redacted) location.
export default function CrewOfferMapPreview({ pin }: CrewOfferMapPreviewProps) {
    const Icon = getTourTeamOfferingIcon({ type: pin.offerType });
    const label = getTourTeamOfferingLabel({ type: pin.offerType, label: pin.offerLabel });
    const locationLabel = getFullLocationName(pin.location);

    return (
        <div className="custom-scrollbar h-full overflow-y-auto p-4">
            <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-900">
                    <Icon className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                    <div className="truncate text-lg font-semibold">{label}</div>
                    {locationLabel && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{locationLabel}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
