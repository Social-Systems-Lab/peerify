"use client";

import React from "react";
import PresenceCard from "./presence-card";
import { Circle } from "@/models/models";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { accommodationSubTypeLabels, getTourTeamOfferingLabel } from "@/lib/data/tour-team-offerings";

interface TourTeamOfferingsCardProps {
    circle: Circle;
    isOwner: boolean;
}

export default function TourTeamOfferingsCard({ circle, isOwner }: TourTeamOfferingsCardProps) {
    const router = useRouter();
    const offerings = circle.tourTeamOfferings || [];

    const onEdit = () => {
        router.push(`/circles/${circle.handle}/settings/presence`);
    };

    if (!isOwner && offerings.length === 0) {
        return null;
    }

    return (
        <PresenceCard title="Offers" isOwner={isOwner} onEdit={onEdit}>
            {offerings.length > 0 ? (
                <>
                    <p className="mb-3 text-xs font-medium text-muted-foreground">
                        Ways I can contribute to visiting artists.
                    </p>
                    <div className="flex flex-col gap-4">
                        {offerings.map((offering) => (
                            <div key={offering.id} className="flex flex-col gap-1">
                                <Badge variant="secondary" className="w-fit">
                                    {getTourTeamOfferingLabel(offering)}
                                    {offering.accommodationType &&
                                        ` · ${accommodationSubTypeLabels[offering.accommodationType]}`}
                                </Badge>
                                {offering.detail && <p className="text-sm text-muted-foreground">{offering.detail}</p>}
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <div className="text-center text-muted-foreground">
                    <p>Ways I can contribute to visiting artists.</p>
                </div>
            )}
        </PresenceCard>
    );
}
