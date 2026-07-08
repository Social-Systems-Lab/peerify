"use client";

import React, { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExclusiveAudio } from "@/lib/audio/use-exclusive-audio";

type TrackPreviewRowProps = {
    title: string;
    durationSec?: number;
    streamUrl: string;
    alwaysShowControl: boolean;
};

const formatDuration = (durationSec?: number): string | null => {
    if (!durationSec || durationSec <= 0) return null;
    const mins = Math.floor(durationSec / 60);
    const secs = Math.floor(durationSec % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export const TrackPreviewRow: React.FC<TrackPreviewRowProps> = ({
    title,
    durationSec,
    streamUrl,
    alwaysShowControl,
}) => {
    const audioRef = useExclusiveAudio();
    const [isPlaying, setIsPlaying] = useState(false);
    const duration = formatDuration(durationSec);

    useEffect(() => {
        const el = audioRef.current;
        if (!el) return;
        const onPlay = () => setIsPlaying(true);
        const onPauseOrEnd = () => setIsPlaying(false);
        el.addEventListener("play", onPlay);
        el.addEventListener("pause", onPauseOrEnd);
        el.addEventListener("ended", onPauseOrEnd);
        return () => {
            el.removeEventListener("play", onPlay);
            el.removeEventListener("pause", onPauseOrEnd);
            el.removeEventListener("ended", onPauseOrEnd);
        };
    }, [audioRef]);

    const togglePlay = (e: React.MouseEvent) => {
        e.stopPropagation();
        const el = audioRef.current;
        if (!el) return;
        if (el.paused) {
            el.play();
        } else {
            el.pause();
        }
    };

    return (
        <li className="group flex items-center gap-3 rounded-md px-1.5 py-1.5 hover:bg-gray-50">
            <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
                className={cn(
                    "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white transition-colors",
                    alwaysShowControl
                        ? "bg-orange-500 hover:bg-orange-600"
                        : isPlaying
                          ? "bg-[#FE801B]"
                          : "bg-gray-400 group-hover:bg-[#FE801B] group-focus-within:bg-[#FE801B]",
                )}
            >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 pl-0.5" />}
            </button>
            <span className="flex-1 truncate text-sm text-gray-700">{title}</span>
            {duration && <span className="flex-shrink-0 text-xs text-gray-500">{duration}</span>}
            <audio
                ref={audioRef}
                src={streamUrl}
                preload="none"
                className="hidden"
                controlsList="nodownload noplaybackrate"
                onContextMenu={(e) => e.preventDefault()}
            >
                Your browser does not support the audio element.
            </audio>
        </li>
    );
};

export default TrackPreviewRow;
