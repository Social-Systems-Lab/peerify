"use client";

import React from "react";
import { Circle } from "@/models/models";
import { Button } from "@/components/ui/button";
import { MapPin, CheckCircle2 } from "lucide-react";
import { useIsCompact } from "@/components/utils/use-is-compact";
import { getPeerifyVenueProfile, isPeerifyVenueIdentity } from "@/lib/peerify/artist-profile";

interface VenueAboutSectionProps {
    circle: Circle;
    onOpenBookingContact: () => void;
}

// Extracted from AboutPage.tsx (venue profile card) — mirrors the same pattern already used by
// sibling cards in that render tree (OffersCard, TourTeamOfferingsCard): a standalone component
// taking `circle` + a couple of computed props, deciding its own visibility internally rather
// than being gated by a flag computed in the parent's ~40-flag block.
export default function VenueAboutSection({ circle, onOpenBookingContact }: VenueAboutSectionProps) {
    const isCompact = useIsCompact();
    const isPeerifyVenueProfile = isPeerifyVenueIdentity(circle);
    const peerifyVenueProfile = getPeerifyVenueProfile(circle);

    const venueLocation =
        peerifyVenueProfile.addressVisibility === "public" && peerifyVenueProfile.address
            ? peerifyVenueProfile.address
            : peerifyVenueProfile.publicCity;
    const venueOverviewDetails = [venueLocation ? { label: "Location", value: venueLocation } : null].filter(
        (item): item is { label: string; value: string } => Boolean(item?.value),
    );
    const venueRoomDetails = [
        peerifyVenueProfile.capacityStanding
            ? { label: "Standing capacity", value: peerifyVenueProfile.capacityStanding }
            : null,
        peerifyVenueProfile.capacitySeated
            ? { label: "Seated capacity", value: peerifyVenueProfile.capacitySeated }
            : null,
        peerifyVenueProfile.typicalShowCapacity
            ? { label: "Typical show capacity", value: peerifyVenueProfile.typicalShowCapacity }
            : null,
        peerifyVenueProfile.accessibilityNotes
            ? { label: "Accessibility notes", value: peerifyVenueProfile.accessibilityNotes, wide: true }
            : null,
        peerifyVenueProfile.agePolicy
            ? { label: "Age policy", value: peerifyVenueProfile.agePolicy, wide: true }
            : null,
    ].filter((item): item is { label: string; value: string; wide?: boolean } => Boolean(item?.value));
    const venueTechnicalDetails = [
        peerifyVenueProfile.paAvailable ? { label: "PA", value: "Available" } : null,
        peerifyVenueProfile.inHouseEngineer ? { label: "In-house engineer", value: "Available" } : null,
        peerifyVenueProfile.backline
            ? { label: "Backline / instruments", value: peerifyVenueProfile.backline, wide: true }
            : null,
        peerifyVenueProfile.lighting ? { label: "Lighting", value: peerifyVenueProfile.lighting, wide: true } : null,
        peerifyVenueProfile.loadInNotes
            ? { label: "Load-in notes", value: peerifyVenueProfile.loadInNotes, wide: true }
            : null,
        peerifyVenueProfile.parkingNotes
            ? { label: "Parking notes", value: peerifyVenueProfile.parkingNotes, wide: true }
            : null,
    ].filter((item): item is { label: string; value: string; wide?: boolean } => Boolean(item?.value));
    const venueFeeCoveredByLabels: Record<string, string> = {
        venue: "Venue",
        artist: "Artist",
        shared: "Shared",
        not_specified: "Not specified",
    };
    const venueBookingDetails = [
        peerifyVenueProfile.bookingEnquiriesEnabled ? { label: "Booking enquiries", value: "Enabled" } : null,
        peerifyVenueProfile.minimumFee ? { label: "Minimum fee", value: peerifyVenueProfile.minimumFee } : null,
        peerifyVenueProfile.doorSplit ? { label: "Door split", value: peerifyVenueProfile.doorSplit } : null,
        peerifyVenueProfile.houseCut
            ? { label: "House cut / production fee", value: peerifyVenueProfile.houseCut }
            : null,
        peerifyVenueProfile.peerifyFeeCoveredBy && peerifyVenueProfile.peerifyFeeCoveredBy !== "not_specified"
            ? {
                  label: "Peerify ticket fee covered by",
                  value: venueFeeCoveredByLabels[peerifyVenueProfile.peerifyFeeCoveredBy],
              }
            : null,
        peerifyVenueProfile.availableDays
            ? { label: "Available days", value: peerifyVenueProfile.availableDays }
            : null,
        peerifyVenueProfile.typicalResponseTime
            ? { label: "Typical response time", value: peerifyVenueProfile.typicalResponseTime }
            : null,
        peerifyVenueProfile.bookingNote
            ? { label: "Booking note", value: peerifyVenueProfile.bookingNote, wide: true }
            : null,
    ].filter((item): item is { label: string; value: string; wide?: boolean } => Boolean(item?.value));
    const venueHospitalityDetails = [
        peerifyVenueProfile.greenRoom ? { label: "Green room", value: "Available" } : null,
        peerifyVenueProfile.merchTable ? { label: "Merch table", value: "Available" } : null,
        peerifyVenueProfile.foodDrink
            ? { label: "Food/drink", value: peerifyVenueProfile.foodDrink, wide: true }
            : null,
        peerifyVenueProfile.accommodationHelp
            ? { label: "Accommodation help", value: peerifyVenueProfile.accommodationHelp, wide: true }
            : null,
        peerifyVenueProfile.localTransportHelp
            ? { label: "Local transport help", value: peerifyVenueProfile.localTransportHelp, wide: true }
            : null,
        peerifyVenueProfile.guestListPolicy
            ? { label: "Guest list policy", value: peerifyVenueProfile.guestListPolicy, wide: true }
            : null,
    ].filter((item): item is { label: string; value: string; wide?: boolean } => Boolean(item?.value));
    const venuePolicyDetails = [
        peerifyVenueProfile.houseRules
            ? { label: "House rules", value: peerifyVenueProfile.houseRules, wide: true }
            : null,
        peerifyVenueProfile.soundCurfew ? { label: "Sound curfew", value: peerifyVenueProfile.soundCurfew } : null,
        peerifyVenueProfile.cancellationPolicy
            ? { label: "Cancellation policy", value: peerifyVenueProfile.cancellationPolicy, wide: true }
            : null,
        peerifyVenueProfile.safetyPolicy
            ? { label: "Safety / conduct policy", value: peerifyVenueProfile.safetyPolicy, wide: true }
            : null,
    ].filter((item): item is { label: string; value: string; wide?: boolean } => Boolean(item?.value));
    const hasVenueProfileContent =
        isPeerifyVenueProfile &&
        (!!circle.description ||
            venueOverviewDetails.length > 0 ||
            venueRoomDetails.length > 0 ||
            venueTechnicalDetails.length > 0 ||
            venueBookingDetails.length > 0 ||
            venueHospitalityDetails.length > 0 ||
            venuePolicyDetails.length > 0);

    const renderVenueDetailSection = (
        title: string,
        details: Array<{ label: string; value: string; wide?: boolean }>,
    ) => {
        if (details.length === 0) {
            return null;
        }

        return (
            <section className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                    {details.map((detail) => (
                        <div
                            key={`${title}-${detail.label}`}
                            className={`rounded-xl border bg-muted/30 p-4 ${detail.wide ? "sm:col-span-2" : ""}`}
                        >
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {detail.label}
                            </div>
                            <div className="whitespace-pre-wrap text-sm text-foreground">{detail.value}</div>
                        </div>
                    ))}
                </div>
            </section>
        );
    };

    if (!hasVenueProfileContent) {
        return null;
    }

    return (
        <div
            id="venue-profile"
            className={`bg-white p-6 ${isCompact ? "rounded-none" : "rounded-[15px] border-0 shadow-lg"}`}
        >
            <div className="space-y-8">
                <section className="space-y-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                            <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                                Venue
                            </div>
                            <h2 className="m-0 text-2xl font-semibold text-foreground">Venue overview</h2>
                            {circle.description ? (
                                <p className="max-w-2xl text-sm text-muted-foreground">{circle.description}</p>
                            ) : null}
                        </div>
                        {peerifyVenueProfile.bookingEnquiriesEnabled ? (
                            <div className="rounded-xl border border-[#e7d8c7] bg-[#f6efe6] p-4 sm:max-w-xs">
                                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[#8f5a2a]">
                                    <CheckCircle2 className="h-4 w-4" />
                                    Booking enquiries enabled
                                </div>
                                <p className="mb-3 text-sm text-[#6a4728]">
                                    Artists can send this venue a booking enquiry.
                                </p>
                                <Button type="button" size="sm" onClick={onOpenBookingContact}>
                                    Send booking enquiry
                                </Button>
                            </div>
                        ) : null}
                    </div>

                    {venueOverviewDetails.length > 0 && (
                        <div className="grid gap-3 sm:grid-cols-2">
                            {venueOverviewDetails.map((detail) => (
                                <div key={detail.label} className="rounded-xl border bg-muted/30 p-4">
                                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        {detail.label}
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-foreground">
                                        {detail.label === "Location" ? (
                                            <MapPin className="h-4 w-4 text-muted-foreground" />
                                        ) : null}
                                        <span>{detail.value}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {renderVenueDetailSection("Room & capacity", venueRoomDetails)}
                {renderVenueDetailSection("Technical setup", venueTechnicalDetails)}
                {renderVenueDetailSection("Booking terms", venueBookingDetails)}
                {renderVenueDetailSection("Hospitality & support", venueHospitalityDetails)}
                {renderVenueDetailSection("House rules & policies", venuePolicyDetails)}
            </div>
        </div>
    );
}
