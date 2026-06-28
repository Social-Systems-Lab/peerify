"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { deleteTrackAction } from "./actions";

type TrackDeleteButtonProps = {
    trackId: string;
    title: string;
};

export const TrackDeleteButton: React.FC<TrackDeleteButtonProps> = ({ trackId, title }) => {
    const { toast } = useToast();
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [confirming, setConfirming] = useState(false);

    const handleDelete = () => {
        startTransition(async () => {
            const result = await deleteTrackAction(trackId);
            if (result.success) {
                toast({ title: "Track deleted", description: `"${title}" was removed.` });
                router.refresh();
            } else {
                toast({
                    title: "Delete failed",
                    description: result.message || "Something went wrong.",
                    variant: "destructive",
                });
                setConfirming(false);
            }
        });
    };

    if (!confirming) {
        return (
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start text-red-600 hover:text-red-700"
                onClick={() => setConfirming(true)}
                disabled={isPending}
            >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete
            </Button>
        );
    }

    return (
        <div className="flex items-center gap-2 self-start">
            <span className="text-sm text-gray-600">Delete this track?</span>
            <Button type="button" variant="destructive" size="sm" onClick={handleDelete} disabled={isPending}>
                {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Yes, delete
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={isPending}
            >
                Cancel
            </Button>
        </div>
    );
};

export default TrackDeleteButton;
