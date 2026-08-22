// broadcast-to-crew-dialog.tsx
"use client";

import React, { useState, useRef } from "react";
import { Circle } from "@/models/models";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Megaphone, Loader2 } from "lucide-react";
import { broadcastToCrewAction } from "./actions";

type BroadcastToCrewDialogProps = {
    circle: Circle;
};

const MAX_LENGTH = 1000;

// Sends one notification to every approved Crew member (crewVisible has no bearing here — that
// flag only controls peer-to-peer visibility in the member rail/offers list, not whether the
// artist can reach a member). See broadcastToCrewAction for the fan-out.
export default function BroadcastToCrewDialog({ circle }: BroadcastToCrewDialogProps) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState("");
    const [isSending, setIsSending] = useState(false);
    // Same real, confirmed race as crew-composer.tsx's handleSubmit: setIsSending(true) doesn't
    // reach the Send button's disabled attribute synchronously, so two clicks close enough
    // together both ran to completion first — reproduced live (2 broadcast posts from one rapid
    // double-click before this guard). A ref closes the window; state updates can't.
    const isSendingRef = useRef(false);

    const onSend = async () => {
        if (isSendingRef.current) return;
        isSendingRef.current = true;
        setIsSending(true);
        try {
            const result = await broadcastToCrewAction(circle, message);

            if (result.success) {
                toast({
                    title: "Message sent",
                    description: `Sent to ${result.recipientCount} Crew member${result.recipientCount === 1 ? "" : "s"}.`,
                });
                setMessage("");
                setOpen(false);
            } else {
                toast({ title: "Error", description: result.message, variant: "destructive" });
            }
        } finally {
            isSendingRef.current = false;
            setIsSending(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-fit">
                    <Megaphone className="mr-2 h-4 w-4" />
                    Message the Crew
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Message the Crew</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                    <Label htmlFor="crew-broadcast-message">Message</Label>
                    <Textarea
                        id="crew-broadcast-message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Share an update with everyone on your Crew…"
                        maxLength={MAX_LENGTH}
                        className="min-h-[120px]"
                    />
                    <div className="text-right text-xs text-muted-foreground">
                        {message.length}/{MAX_LENGTH}
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isSending}>
                        Cancel
                    </Button>
                    <Button onClick={onSend} disabled={isSending || !message.trim()}>
                        {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {isSending ? "Sending…" : "Send to Crew"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
