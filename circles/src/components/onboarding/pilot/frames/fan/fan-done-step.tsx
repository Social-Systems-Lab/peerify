"use client";

import { Button } from "@/components/ui/button";

type FanDoneStepProps = {
    onExplore: () => void;
};

export function FanDoneStep({ onExplore }: FanDoneStepProps) {
    return (
        <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
                Start exploring artists on the map, or follow a few to get your feed going.
            </p>
            <Button type="button" className="w-full" onClick={onExplore}>
                Explore the map
            </Button>
        </div>
    );
}
