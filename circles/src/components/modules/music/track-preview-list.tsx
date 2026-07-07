"use client";

import React, { useEffect, useState } from "react";
import { getTracksForCirclePreviewAction, TrackPreview } from "@/components/modules/circles/map-explorer-actions";
import { useIsMobile } from "@/components/utils/use-is-mobile";
import { TrackPreviewRow } from "./track-preview-row";

type TrackPreviewListProps = {
    circleId: string;
};

export const TrackPreviewList: React.FC<TrackPreviewListProps> = ({ circleId }) => {
    const [tracks, setTracks] = useState<TrackPreview[] | null>(null);
    const isMobile = useIsMobile();

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
                        title={track.title}
                        durationSec={track.durationSec}
                        streamUrl={track.streamUrl}
                        alwaysShowControl={!!isMobile}
                    />
                ))}
            </ul>
        </div>
    );
};

export default TrackPreviewList;
