"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { TourTeamOffering } from "@/models/models";
import {
    getOfferDetailsSummary,
    getTourTeamOfferingIcon,
    getTourTeamOfferingLabel,
    accommodationSubTypeLabels,
    OFFER_MODAL_TYPES,
} from "@/lib/data/tour-team-offerings";
import { CreateOfferModal } from "./create-offer-modal";

interface OfferManagerProps {
    value: TourTeamOffering[] | undefined;
    onChange: (offerings: TourTeamOffering[]) => void;
    // Defaults to the full OFFER_MODAL_TYPES set (individual/"user" profiles) — venues pass
    // VENUE_OFFER_MODAL_TYPES to hide predefined types that don't fit a business profile. See
    // that constant's comment in tour-team-offerings.ts.
    allowedTypes?: readonly (typeof OFFER_MODAL_TYPES)[number][];
}

export function OfferManager({ value, onChange, allowedTypes = OFFER_MODAL_TYPES }: OfferManagerProps) {
    const [modalOpen, setModalOpen] = useState(false);
    const offerings = useMemo(() => (Array.isArray(value) ? value : []), [value]);

    const existingTypes = useMemo(
        () => new Set(offerings.filter((o) => o.type !== "custom").map((o) => o.type)),
        [offerings],
    );

    const removeOffering = (id: string) => {
        onChange(offerings.filter((offering) => offering.id !== id));
    };

    const addOffering = (offering: TourTeamOffering) => {
        onChange([...offerings, offering]);
    };

    return (
        <div className="space-y-3">
            {offerings.length > 0 && (
                <div className="space-y-2">
                    {offerings.map((offering) => {
                        const Icon = getTourTeamOfferingIcon(offering);
                        const summary = getOfferDetailsSummary(offering);
                        const thumbnail = offering.photos?.[0]?.url;
                        return (
                            <div key={offering.id} className="flex items-start gap-3 rounded-md border px-3 py-2">
                                {thumbnail ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={thumbnail} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                                ) : (
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted">
                                        <Icon className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1 space-y-0.5">
                                    <p className="text-sm font-medium">{getTourTeamOfferingLabel(offering)}</p>
                                    {offering.accommodationType && (
                                        <p className="text-xs text-muted-foreground">
                                            {accommodationSubTypeLabels[offering.accommodationType]}
                                        </p>
                                    )}
                                    {/* Bare-bones fallback for legacy offerings with no structured `details` yet
                                        (all current data is demo data) — falls back to the old free-text `detail`
                                        field, same as before this modal existed. */}
                                    {summary ? (
                                        <p className="text-xs text-muted-foreground">{summary}</p>
                                    ) : offering.detail ? (
                                        <p className="text-xs text-muted-foreground">{offering.detail}</p>
                                    ) : null}
                                </div>
                                <button
                                    type="button"
                                    aria-label="Remove offering"
                                    onClick={() => removeOffering(offering.id)}
                                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/10"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            <Button type="button" variant="outline" onClick={() => setModalOpen(true)}>
                Add an offer
            </Button>

            <CreateOfferModal
                open={modalOpen}
                onOpenChange={setModalOpen}
                allowedTypes={allowedTypes}
                existingTypes={existingTypes}
                onAdd={addOffering}
            />
        </div>
    );
}
