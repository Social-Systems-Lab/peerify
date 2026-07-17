"use client";

import React from "react";
import PresenceCard from "./presence-card";
import { Circle } from "@/models/models";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { getTourTeamOfferingLabel } from "@/lib/data/tour-team-offerings";

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
        <PresenceCard title="Tour-Team Offerings" isOwner={isOwner} onEdit={onEdit}>
            {offerings.length > 0 ? (
                <div className="flex flex-col gap-2">
                    {offerings.map((offering) => (
                        <div key={offering.id} className="flex flex-col">
                            <Badge variant="secondary" className="w-fit">
                                {getTourTeamOfferingLabel(offering)}
                            </Badge>
                            {offering.detail && <p className="mt-1 text-sm text-muted-foreground">{offering.detail}</p>}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center text-muted-foreground">
                    <p>Let touring artists know what you can offer when they come through your city.</p>
                </div>
            )}
        </PresenceCard>
    );
}
