"use client";

import React, { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Circle, CircleDot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { setFeaturedTrackAction } from "./actions";

type TrackFeaturedToggleProps = {
    circleId: string;
    trackId: string;
    title: string;
    isFeatured: boolean;
};

export const TrackFeaturedToggle: React.FC<TrackFeaturedToggleProps> = ({ circleId, trackId, title, isFeatured }) => {
    const { toast } = useToast();
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const handleToggle = () => {
        startTransition(async () => {
            const result = await setFeaturedTrackAction(circleId, isFeatured ? null : trackId);
            if (result.success) {
                toast({
                    title: isFeatured ? "Removed as featured" : "Marked as featured",
                    description: isFeatured
                        ? `"${title}" will no longer play first.`
                        : `"${title}" will now play first wherever your music is previewed.`,
                });
                router.refresh();
            } else {
                toast({
                    title: "Couldn't update featured track",
                    description: result.message || "Something went wrong.",
                    variant: "destructive",
                });
            }
        });
    };

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleToggle}
            disabled={isPending}
            aria-pressed={isFeatured}
            className={`flex items-center gap-1.5 px-2 ${isFeatured ? "text-amber-500 hover:text-amber-600" : "text-gray-500 hover:text-gray-700"}`}
        >
            {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
            ) : isFeatured ? (
                <CircleDot className="h-4 w-4" />
            ) : (
                <Circle className="h-4 w-4" />
            )}
            <span className="text-xs">{isFeatured ? "Featured" : "Feature"}</span>
        </Button>
    );
};

export default TrackFeaturedToggle;
