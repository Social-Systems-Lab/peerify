"use client";

import React, { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
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
        <label className="flex items-center gap-2 px-2 text-xs text-gray-500">
            <span>{isFeatured ? "Featured" : "Feature"}</span>
            <Switch
                checked={isFeatured}
                onCheckedChange={handleToggle}
                disabled={isPending}
                aria-label={isFeatured ? `Un-feature ${title}` : `Feature ${title}`}
            />
        </label>
    );
};

export default TrackFeaturedToggle;
