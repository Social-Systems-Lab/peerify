"use client";

// "Share" on the event page (Crew R1, item 5): the phone's share sheet where there is one,
// otherwise the short text (title, date, city, link) is copied for pasting.

import React from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import type { EventDisplay } from "@/models/models";
import { buildEventShareText, eventPath } from "@/lib/events/event-share";

type Props = {
    event: EventDisplay;
    circleHandle: string;
    eventId: string;
    size?: "sm" | "default";
};

export default function ShareEventButton({ event, circleHandle, eventId, size = "default" }: Props) {
    const { toast } = useToast();

    const onShare = async () => {
        const url = `${window.location.origin}${eventPath(circleHandle, eventId)}`;
        const text = buildEventShareText(event, url);
        if (typeof navigator.share === "function") {
            try {
                await navigator.share({ title: event.title, text });
                return;
            } catch (error) {
                // Closing the share sheet is not an error.
                if (error instanceof DOMException && error.name === "AbortError") return;
            }
        }
        try {
            await navigator.clipboard.writeText(text);
            toast({ title: "Copied", description: "The event's title, date, place and link are ready to paste." });
        } catch {
            toast({ title: "Couldn't copy", description: url, variant: "destructive" });
        }
    };

    return (
        <Button variant="outline" size={size} onClick={onShare}>
            <Share2 className="mr-2 h-4 w-4" />
            Share
        </Button>
    );
}
