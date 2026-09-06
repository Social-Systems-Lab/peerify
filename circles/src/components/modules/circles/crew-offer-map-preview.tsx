// crew-offer-map-preview.tsx
"use client";

import React from "react";
import { MapPin } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
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
// for an individual host — no did/name/handle/picture — consistent with offers being browsable
// before any Crew/artist relationship exists, and with the (not-yet-built) anonymized-
// contact-thread design where the host stays hidden until they choose to reply. That pin still
// renders exactly as before: no name, no avatar/initials, no "View profile" link — just the offer
// type/label and its (already viewer-precision-redacted) location.
//
// Venue-sourced pins (circleHandle present — see getOfferMapPins, lib/data/circle.ts) are the
// deliberate exception: they carry circleName/circlePicture and render an avatar + name +
// "View profile" link here. Anonymity exists to protect individuals; a venue is already a public
// business listing, and an anonymous "hosting a show somewhere nearby" pin isn't actionable for
// booking purposes.
//
// groupedOfferings (map-explorer.tsx's groupIdentityOfferPins) is only ever present on venue
// pins — co-located same-venue offerings are merged into one marker rather than jittered apart
// (see that function's own comment), so this is the one surface that lists what got merged.
// length > 1 replaces the single label line with a short list (icon + label per offering);
// length <= 1 (including anonymous pins, which never carry this field) renders exactly as before.
export default function CrewOfferMapPreview({ pin }: CrewOfferMapPreviewProps) {
    const Icon = getTourTeamOfferingIcon({ type: pin.offerType });
    const label = getTourTeamOfferingLabel({ type: pin.offerType, label: pin.offerLabel });
    const locationLabel = getFullLocationName(pin.location);
    const isVenue = Boolean(pin.circleHandle);
    const isGrouped = Boolean(pin.groupedOfferings && pin.groupedOfferings.length > 1);

    return (
        <div className="custom-scrollbar h-full overflow-y-auto p-4">
            <div className="flex items-center gap-3">
                {isVenue && pin.circlePicture?.url ? (
                    <Image
                        src={pin.circlePicture.url}
                        alt=""
                        width={56}
                        height={56}
                        className="h-14 w-14 shrink-0 rounded-full object-cover"
                    />
                ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-900">
                        <Icon className="h-6 w-6" />
                    </div>
                )}
                <div className="min-w-0">
                    <div className="truncate text-lg font-semibold">{isVenue ? pin.circleName : label}</div>
                    {isVenue && !isGrouped && <div className="truncate text-sm text-muted-foreground">{label}</div>}
                    {locationLabel && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{locationLabel}</span>
                        </div>
                    )}
                </div>
            </div>
            {isGrouped && (
                <ul className="mt-4 space-y-2">
                    {pin.groupedOfferings!.map((offering, index) => {
                        const OfferIcon = getTourTeamOfferingIcon({ type: offering.offerType });
                        const offerLabel = getTourTeamOfferingLabel({
                            type: offering.offerType,
                            label: offering.offerLabel,
                        });
                        return (
                            <li key={`${offering.offerType}:${index}`} className="flex items-center gap-2 text-sm">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-900">
                                    <OfferIcon className="h-3.5 w-3.5" />
                                </span>
                                <span className="truncate">{offerLabel}</span>
                            </li>
                        );
                    })}
                </ul>
            )}
            {isVenue && pin.circleHandle && (
                <Link
                    href={`/circles/${pin.circleHandle}`}
                    className="mt-4 inline-flex items-center text-sm font-medium text-primary hover:underline"
                >
                    View profile
                </Link>
            )}
        </div>
    );
}
