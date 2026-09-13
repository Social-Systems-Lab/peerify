"use client";

import React, { useState } from "react";
import PresenceCard from "./presence-card";
import { Circle, TourTeamOffering } from "@/models/models";
import { Button } from "@/components/ui/button";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import { isPeerifyVenueIdentity } from "@/lib/peerify/artist-profile";
import {
    accommodationSubTypeLabels,
    getOfferDetailFields,
    getTourTeamOfferingIcon,
    getTourTeamOfferingLabel,
    sortOfferingsForDisplay,
} from "@/lib/data/tour-team-offerings";

interface TourTeamOfferingsCardProps {
    circle: Circle;
    canManage: boolean;
}

export default function TourTeamOfferingsCard({ circle, canManage }: TourTeamOfferingsCardProps) {
    const router = useRouter();
    const offerings = sortOfferingsForDisplay(circle.tourTeamOfferings || []);
    // Same isVenue-branches-copy pattern presence-settings-form.tsx already uses for this section
    // ("Unlike an individual profile, a venue offer pin shows your venue's name...") — first-person
    // singular reads oddly on a venue's business profile, so venues get "we" instead of "I".
    const subtitleCopy = isPeerifyVenueIdentity(circle)
        ? "Ways we can contribute to visiting artists."
        : "Ways I can contribute to visiting artists.";

    // Presence settings is also where CreateOfferModal actually lives (via OfferManager) and
    // where an added/edited offer gets persisted (its own "Save Changes" button) — CreateOfferModal
    // itself only holds in-memory state, so both Edit and "Add an offer" route here rather than
    // opening the modal directly on the profile page.
    const goToPresenceSettings = () => {
        router.push(`/circles/${circle.handle}/settings/presence`);
    };

    if (!canManage && offerings.length === 0) {
        return null;
    }

    return (
        <PresenceCard title="Offers" isOwner={canManage} onEdit={goToPresenceSettings}>
            {offerings.length > 0 ? (
                <>
                    <p className="mb-3 text-xs font-medium text-muted-foreground">{subtitleCopy}</p>
                    <Carousel opts={{ align: "start", dragFree: true }} className="w-full">
                        <CarouselContent className="-ml-3">
                            {offerings.map((offering) => (
                                <CarouselItem key={offering.id} className="basis-[240px] pl-3">
                                    <OfferTile offering={offering} />
                                </CarouselItem>
                            ))}
                        </CarouselContent>
                    </Carousel>
                </>
            ) : (
                <div className="flex flex-col items-center gap-3 py-2 text-center text-muted-foreground">
                    <p>{subtitleCopy}</p>
                    <Button type="button" variant="outline" onClick={goToPresenceSettings}>
                        Add an offer
                    </Button>
                </div>
            )}
        </PresenceCard>
    );
}

function OfferTile({ offering }: { offering: TourTeamOffering }) {
    const [modalOpen, setModalOpen] = useState(false);
    const Icon = getTourTeamOfferingIcon(offering);
    const label = getTourTeamOfferingLabel(offering);
    const photoUrl = offering.photos?.[0]?.url;
    // "What kind of space?" is already shown persistently in the header (accommodationType), so
    // drop it here to avoid rendering the same fact twice in the modal.
    const detailFields = getOfferDetailFields(offering).filter((field) => field.label !== "What kind of space?");

    return (
        <>
            <div
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-label={`Open ${label} details`}
                onClick={() => setModalOpen(true)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setModalOpen(true);
                    }
                }}
                className="flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white text-left"
                style={{ borderColor: "var(--pc-line)" }}
            >
                <div className="relative h-28 w-full shrink-0">
                    {photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center" style={{ backgroundColor: "var(--pc-orange-tint)" }}>
                            <Icon className="h-9 w-9" style={{ color: "var(--pc-orange-deep)" }} />
                        </div>
                    )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                    <div className="flex items-center gap-1.5">
                        <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--pc-orange-deep)" }} />
                        <span className="truncate text-sm font-medium" style={{ color: "var(--pc-ink)" }}>
                            {label}
                        </span>
                    </div>
                    {offering.accommodationType && (
                        <p className="text-xs" style={{ color: "var(--pc-muted)" }}>
                            {accommodationSubTypeLabels[offering.accommodationType]}
                        </p>
                    )}
                    {offering.detail && (
                        <p className="line-clamp-2 text-xs" style={{ color: "var(--pc-muted)" }}>
                            {offering.detail}
                        </p>
                    )}
                </div>
            </div>

            {/* Full-detail modal — same Dialog/DialogContent primitive (and default
                X/click-outside/Esc close behavior) as the Noticeboard post detail modal
                (post-list.tsx's "Post Detail Modal"), just with this offering's own content. */}
            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto p-0">
                    {photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photoUrl} alt="" className="h-56 w-full object-cover" />
                    ) : (
                        <div className="flex h-40 w-full items-center justify-center" style={{ backgroundColor: "var(--pc-orange-tint)" }}>
                            <Icon className="h-14 w-14" style={{ color: "var(--pc-orange-deep)" }} />
                        </div>
                    )}
                    <div className="space-y-3 p-5">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2" style={{ color: "var(--pc-ink)" }}>
                                <Icon className="h-5 w-5 shrink-0" style={{ color: "var(--pc-orange-deep)" }} />
                                {label}
                            </DialogTitle>
                        </DialogHeader>
                        {offering.accommodationType && (
                            <p className="text-sm" style={{ color: "var(--pc-muted)" }}>
                                {accommodationSubTypeLabels[offering.accommodationType]}
                            </p>
                        )}
                        {offering.detail && (
                            <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--pc-muted)" }}>
                                {offering.detail}
                            </p>
                        )}
                        {detailFields.length > 0 && (
                            <div className="space-y-1.5 border-t pt-3" style={{ borderColor: "var(--pc-line)" }}>
                                {detailFields.map((field) => (
                                    <p key={field.label} className="text-sm" style={{ color: "var(--pc-muted)" }}>
                                        <span className="font-medium" style={{ color: "var(--pc-ink)" }}>
                                            {field.label}:
                                        </span>{" "}
                                        {field.value}
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
