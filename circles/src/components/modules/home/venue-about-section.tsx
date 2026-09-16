"use client";

import React from "react";
import { Circle } from "@/models/models";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { useIsCompact } from "@/components/utils/use-is-compact";
import { getPeerifyVenueProfile, hasPeerifyVenueProfileContent, isPeerifyVenueIdentity } from "@/lib/peerify/artist-profile";

interface VenueAboutSectionProps {
    circle: Circle;
    onOpenBookingContact: () => void;
}

// Extracted from AboutPage.tsx (venue profile card) — mirrors the same pattern already used by
// sibling cards in that render tree (OffersCard, TourTeamOfferingsCard): a standalone component
// taking `circle` + a couple of computed props, deciding its own visibility internally rather
// than being gated by a flag computed in the parent's ~40-flag block.
//
// Room & Capacity / Technical setup / Booking terms / Hospitality & support / House rules &
// policies used to render here in full; that detail now lives on its own page
// (/circles/{handle}/booking, venue-booking-detail.tsx) since it serves a different audience
// (artists/crews actively booking) than this general About page. This component keeps only the
// booking-enquiries-enabled callout — a CTA, not data the reader is browsing — as a lightweight
// pointer toward that page.
export default function VenueAboutSection({ circle, onOpenBookingContact }: VenueAboutSectionProps) {
    const isCompact = useIsCompact();
    const isPeerifyVenueProfile = isPeerifyVenueIdentity(circle);
    const peerifyVenueProfile = getPeerifyVenueProfile(circle);

    if (!isPeerifyVenueProfile || !hasPeerifyVenueProfileContent(peerifyVenueProfile)) {
        return null;
    }

    return (
        <div
            id="venue-profile"
            className={`bg-white p-6 ${isCompact ? "rounded-none" : "rounded-[15px] border-0 shadow-lg"}`}
        >
            <section className="space-y-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                            Venue
                        </div>
                        <h2 className="m-0 text-2xl font-semibold text-foreground">Venue overview</h2>
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
            </section>
        </div>
    );
}
