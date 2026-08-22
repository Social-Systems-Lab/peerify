// crew-offers-widget.tsx
"use client";

import React, { useEffect, useState } from "react";
import { Circle } from "@/models/models";
import { Badge } from "@/components/ui/badge";
import { CirclePicture } from "@/components/modules/circles/circle-picture";
import { accommodationSubTypeLabels, getTourTeamOfferingLabel } from "@/lib/data/tour-team-offerings";
import { getCrewOffersAction, CrewOfferAggregateEntry } from "./actions";
import { CrewOfferer } from "@/lib/data/member";

type CrewOffersWidgetProps = {
    circle: Circle;
};

type WidgetState =
    | { loading: true }
    | { loading: false; isAdminOrMod: true; offerers: CrewOfferer[] }
    | { loading: false; isAdminOrMod: false; aggregate: CrewOfferAggregateEntry[] };

// Same cap-with-"+N" treatment as the member rail, applied on both mobile and desktop for the
// same reason — a plain crew member's aggregate is meant to be a glanceable summary, not a full
// category listing.
const VISIBLE_TAG_CAP = 5;

// Two very different shapes depending on viewer role, both sourced from getCrewOffersAction
// (which decides server-side which one to even compute — a plain crew member's response never
// contains other members' names or avatars at all, not just a rendering choice):
// - Admins/moderators: the full per-person breakdown (who offers what) — they already have
//   legitimate reason to know who's behind each offer.
// - Plain crew members: an aggregate-only summary (counts per category), ambient sidebar
//   context rather than a competing section — no names, no avatars.
export default function CrewOffersWidget({ circle }: CrewOffersWidgetProps) {
    const [state, setState] = useState<WidgetState>({ loading: true });
    const [showAllTags, setShowAllTags] = useState(false);

    useEffect(() => {
        let isCurrent = true;
        getCrewOffersAction(circle._id ?? "").then((result) => {
            if (!isCurrent) return;
            if (result.isAdminOrMod) {
                setState({ loading: false, isAdminOrMod: true, offerers: result.offerers ?? [] });
            } else {
                setState({ loading: false, isAdminOrMod: false, aggregate: result.aggregate ?? [] });
            }
        });
        return () => {
            isCurrent = false;
        };
    }, [circle._id]);

    return (
        <div className="rounded-[18px] border border-black/5 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Crew Offers</h2>
            {state.loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : state.isAdminOrMod ? (
                state.offerers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No Crew members have shared what they can help with yet.</p>
                ) : (
                    <div className="flex flex-col divide-y divide-black/5">
                        {state.offerers.map((offerer) => (
                            <div key={offerer.userDid} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                                <div className="flex items-center gap-2">
                                    <CirclePicture circle={{ name: offerer.name, picture: offerer.picture }} size="24px" />
                                    <span className="text-sm font-medium">{offerer.name}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 pl-[32px]">
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
                )
            ) : state.aggregate.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Crew offers yet.</p>
            ) : (
                <div className="flex flex-wrap items-center gap-2">
                    {(showAllTags ? state.aggregate : state.aggregate.slice(0, VISIBLE_TAG_CAP)).map((entry) => (
                        <Badge key={entry.type} variant="offering">
                            {entry.count} offering {entry.label}
                        </Badge>
                    ))}
                    {!showAllTags && state.aggregate.length > VISIBLE_TAG_CAP && (
                        <button
                            type="button"
                            onClick={() => setShowAllTags(true)}
                            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                            +{state.aggregate.length - VISIBLE_TAG_CAP} more
                        </button>
                    )}
                    {showAllTags && state.aggregate.length > VISIBLE_TAG_CAP && (
                        <button
                            type="button"
                            onClick={() => setShowAllTags(false)}
                            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                            Show less
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
