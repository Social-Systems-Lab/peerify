"use client";

import React, { useEffect, useState } from "react";
import { getTracksForCirclePreviewAction, TrackPreview } from "@/components/modules/circles/map-explorer-actions";
import { useIsMobile } from "@/components/utils/use-is-mobile";
import { TrackPreviewRow } from "./track-preview-row";
import { Circle, UserPrivate } from "@/models/models";

type TrackPreviewListProps = {
    circle: Circle;
    user: UserPrivate | null;
};

export const TrackPreviewList: React.FC<TrackPreviewListProps> = ({ circle, user }) => {
    const [tracks, setTracks] = useState<TrackPreview[] | null>(null);
    const isMobile = useIsMobile();
    const circleId = circle._id!.toString();

    useEffect(() => {
        let cancelled = false;
        setTracks(null);
        getTracksForCirclePreviewAction(circleId).then((result) => {
            if (!cancelled) setTracks(result);
        });
        return () => {
            cancelled = true;
        };
    }, [circleId]);

    if (!tracks || tracks.length === 0) return null;

    return (
        <div className="mt-4">
            <h3 className="mb-1.5 text-xs font-medium uppercase text-gray-500">Songs</h3>
            <ul className="flex flex-col gap-0.5">
                {tracks.map((track) => (
                    <TrackPreviewRow
                        key={track.id}
                        trackId={track.id}
                        title={track.title}
                        durationSec={track.durationSec}
                        streamUrl={track.streamUrl}
                        commentCount={track.commentCount}
                        alwaysShowControl={!!isMobile}
                        circle={circle}
                        user={user}
                    />
                ))}
            </ul>
        </div>
    );
};

export default TrackPreviewList;
