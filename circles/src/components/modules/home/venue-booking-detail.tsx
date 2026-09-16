"use client";

import React from "react";
import { Circle } from "@/models/models";
import { useIsCompact } from "@/components/utils/use-is-compact";
import { getPeerifyVenueProfile } from "@/lib/peerify/artist-profile";

interface VenueBookingDetailProps {
    circle: Circle;
}

// Room & Capacity / Technical setup / Booking terms / Hospitality & support / House rules &
// policies — moved here from VenueAboutSection (venue-about-section.tsx), which now only
// surfaces a lightweight "booking info available" pointer on the general About page. Rendering
// logic (the detail arrays + renderVenueDetailSection) is unchanged from that prior home, just
// relocated onto its own page since this content serves a different audience (artists/crews
// actively booking) than the venue's general presentation content.
export default function VenueBookingDetail({ circle }: VenueBookingDetailProps) {
    const isCompact = useIsCompact();
    const peerifyVenueProfile = getPeerifyVenueProfile(circle);

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

    return (
        <div
            id="venue-booking-detail"
            className={`bg-white p-6 ${isCompact ? "rounded-none" : "rounded-[15px] border-0 shadow-lg"}`}
        >
            <div className="space-y-8">
                <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Venue</div>
                    <h1 className="m-0 text-2xl font-semibold text-foreground">Booking &amp; venue details</h1>
                </div>

                {renderVenueDetailSection("Room & capacity", venueRoomDetails)}
                {renderVenueDetailSection("Technical setup", venueTechnicalDetails)}
                {renderVenueDetailSection("Booking terms", venueBookingDetails)}
                {renderVenueDetailSection("Hospitality & support", venueHospitalityDetails)}
                {renderVenueDetailSection("House rules & policies", venuePolicyDetails)}
            </div>
        </div>
    );
}
