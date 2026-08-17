"use client";

import React, { useEffect, useState } from "react";
import { MessageCircle, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExclusiveAudio } from "@/lib/audio/use-exclusive-audio";
import { Circle, UserPrivate } from "@/models/models";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SongCommentsPanel } from "./song-comments-panel";

type TrackPreviewRowProps = {
    trackId: string;
    title: string;
    durationSec?: number;
    streamUrl: string;
    commentCount: number;
    alwaysShowControl: boolean;
    circle: Circle;
    user: UserPrivate | null;
};

const formatDuration = (durationSec?: number): string | null => {
    if (!durationSec || durationSec <= 0) return null;
    const mins = Math.floor(durationSec / 60);
    const secs = Math.floor(durationSec % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export const TrackPreviewRow: React.FC<TrackPreviewRowProps> = ({
    trackId,
    title,
    durationSec,
    streamUrl,
    commentCount,
    alwaysShowControl,
    circle,
    user,
}) => {
    const audioRef = useExclusiveAudio();
    const [isPlaying, setIsPlaying] = useState(false);
    const [showComments, setShowComments] = useState(false);
    const [liveCommentCount, setLiveCommentCount] = useState(commentCount);
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
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                    e.stopPropagation();
                    setShowComments(true);
                }}
                className="flex h-auto flex-shrink-0 items-center gap-1 px-1.5 py-1 text-gray-500 hover:text-gray-900"
            >
                <MessageCircle className="h-3.5 w-3.5" />
                <span className="text-xs">{liveCommentCount}</span>
            </Button>
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
            <Dialog open={showComments} onOpenChange={setShowComments}>
                <DialogContent className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
                    <div className="hidden">
                        <DialogTitle>Comments on {title}</DialogTitle>
                    </div>
                    <SongCommentsPanel
                        trackId={trackId}
                        circle={circle}
                        user={user}
                        onCommentCountChange={setLiveCommentCount}
                    />
                </DialogContent>
            </Dialog>
        </li>
    );
};

export default TrackPreviewRow;
