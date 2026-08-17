"use client";

import React, { useState } from "react";
import { Circle, UserPrivate } from "@/models/models";
import AudioPlayer from "./audio-player";
import TrackDeleteButton from "./track-delete-button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { SongCommentsPanel } from "./song-comments-panel";

type TrackRowProps = {
    trackId: string;
    title: string;
    durationSec?: number;
    streamUrl: string;
    initialCommentCount: number;
    circle: Circle;
    user: UserPrivate | null;
    canManage: boolean;
};

export const TrackRow: React.FC<TrackRowProps> = ({
    trackId,
    title,
    durationSec,
    streamUrl,
    initialCommentCount,
    circle,
    user,
    canManage,
}) => {
    const [showComments, setShowComments] = useState(false);
    const [commentCount, setCommentCount] = useState(initialCommentCount);

    return (
        <li className="flex flex-col gap-2 rounded-lg border p-4">
            <span className="font-medium">{title}</span>
            <AudioPlayer src={streamUrl} durationSec={durationSec} />
            <div className="flex items-center gap-3">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowComments(true)}
                    className="flex items-center gap-1 px-2 text-gray-600 hover:text-gray-900"
                >
                    <MessageCircle className="h-4 w-4" />
                    <span className="text-xs">{commentCount}</span>
                </Button>
                {canManage && <TrackDeleteButton trackId={trackId} title={title} />}
            </div>
            <Dialog open={showComments} onOpenChange={setShowComments}>
                <DialogContent className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
                    <div className="hidden">
                        <DialogTitle>Comments on {title}</DialogTitle>
                    </div>
                    <SongCommentsPanel trackId={trackId} circle={circle} user={user} onCommentCountChange={setCommentCount} />
                </DialogContent>
            </Dialog>
        </li>
    );
};

export default TrackRow;
