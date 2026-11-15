"use client";

// "Share" on the event page: one button (Tim, 2026-11-15). On a phone it opens the share sheet with
// the short text (title once, date, city or public label, link). On desktop it opens a small dialog
// with the event link and a "Copy" button, the same look as "Invite people to the circle". The
// choice is detectEventShareMode in lib/events/event-share.ts.

import React, { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import type { EventDisplay } from "@/models/models";
import { buildEventSharePayload, detectEventShareMode, eventPath } from "@/lib/events/event-share";

type Props = {
    event: EventDisplay;
    circleHandle: string;
    eventId: string;
    size?: "sm" | "default";
};

export default function ShareEventButton({ event, circleHandle, eventId, size = "default" }: Props) {
    const { toast } = useToast();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [link, setLink] = useState("");

    const eventUrl = () => `${window.location.origin}${eventPath(circleHandle, eventId)}`;

    const onShare = async () => {
        const url = eventUrl();
        setLink(url);
        const mode = detectEventShareMode(
            navigator,
            typeof window.matchMedia === "function" ? (q) => window.matchMedia(q) : undefined,
        );
        if (mode === "sheet") {
            try {
                await navigator.share(buildEventSharePayload(event, url));
                return;
            } catch (error) {
                // Closing the share sheet is not an error.
                if (error instanceof DOMException && error.name === "AbortError") return;
                // Anything else: fall through to the dialog.
            }
        }
        setDialogOpen(true);
    };

    const onCopy = async () => {
        try {
            await navigator.clipboard.writeText(link);
            toast({ title: "Link copied", description: "The event link has been copied to the clipboard." });
        } catch {
            toast({ title: "Couldn't copy", description: link, variant: "destructive" });
        }
    };

    return (
        <>
            <Button variant="outline" size={size} onClick={onShare}>
                <Share2 className="mr-2 h-4 w-4" />
                Share
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Share this event</DialogTitle>
                        <DialogDescription>Copy the link and send it to anyone you like.</DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center space-x-2">
                        <Input className="flex-1" value={link} readOnly onFocus={(e) => e.currentTarget.select()} />
                        <Button type="button" onClick={onCopy}>
                            Copy
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
