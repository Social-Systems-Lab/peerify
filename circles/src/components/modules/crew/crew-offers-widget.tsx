// crew-offers-widget.tsx
"use client";

import React, { useEffect, useState } from "react";
import { Circle } from "@/models/models";
import { Badge } from "@/components/ui/badge";
import { CirclePicture } from "@/components/modules/circles/circle-picture";
import { accommodationSubTypeLabels, getTourTeamOfferingLabel } from "@/lib/data/tour-team-offerings";
import { getCrewOffersAction } from "./actions";
import { CrewOfferer } from "@/lib/data/member";

type CrewOffersWidgetProps = {
    circle: Circle;
};

// A single card listing every visible crew peer's Offers (src/lib/data/tour-team-offerings.ts —
// "ways I can contribute to visiting artists"), not a stack of one TourTeamOfferingsCard per
// person — that component is built around a single profile-owner context (title "Offers", an
// edit button, no name/avatar of its own), which doesn't identify who owns which entry once
// several people's offerings are shown together. This reuses its label-rendering helpers
// directly instead, grouped under each member's own name/avatar.
export default function CrewOffersWidget({ circle }: CrewOffersWidgetProps) {
    const [offerers, setOfferers] = useState<CrewOfferer[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isCurrent = true;
        getCrewOffersAction(circle._id ?? "").then((result) => {
            if (isCurrent) {
                setOfferers(result.offerers);
                setIsLoading(false);
            }
        });
        return () => {
            isCurrent = false;
        };
    }, [circle._id]);

    return (
        <div className="rounded-[18px] border border-black/5 bg-white p-6 shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
            <h1 className="my-4">Crew Offers</h1>
            {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : offerers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    No Crew members have shared what they can help with yet.
                </p>
            ) : (
                <div className="flex flex-col divide-y divide-black/5">
                    {offerers.map((offerer) => (
                        <div key={offerer.userDid} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                            <div className="flex items-center gap-2">
                                <CirclePicture circle={{ name: offerer.name, picture: offerer.picture }} size="28px" />
                                <span className="text-sm font-medium">{offerer.name}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pl-[36px]">
                                {offerer.tourTeamOfferings.map((offering) => (
                                    <Badge key={offering.id} variant="offering">
                                        {getTourTeamOfferingLabel(offering)}
                                        {offering.accommodationType &&
                                            ` · ${accommodationSubTypeLabels[offering.accommodationType]}`}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
