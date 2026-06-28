"use client";

// Peerify spike: minimal native HTML5 audio player. Playback in the map popup /
// side-panel player is a later session — this is intentionally just <audio controls>.

import React from "react";

type AudioPlayerProps = {
    src: string;
    durationSec?: number;
};

const formatDuration = (durationSec?: number): string | null => {
    if (!durationSec || durationSec <= 0) return null;
    const mins = Math.floor(durationSec / 60);
    const secs = Math.floor(durationSec % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, durationSec }) => {
    const duration = formatDuration(durationSec);
    return (
        <div className="flex flex-col gap-1">
            <audio
                controls
                controlsList="nodownload noplaybackrate"
                onContextMenu={(e) => e.preventDefault()}
                preload="metadata"
                src={src}
                className="w-full"
            >
                Your browser does not support the audio element.
            </audio>
            {duration && <span className="text-xs text-gray-500">{duration}</span>}
        </div>
    );
};

export default AudioPlayer;
