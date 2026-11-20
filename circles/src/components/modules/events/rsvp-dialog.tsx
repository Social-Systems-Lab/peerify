"use client";

import React, { useState, useTransition } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import { rsvpEventWithOptionsAction } from "@/app/circles/[handle]/events/actions";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    circleHandle: string;
    eventId: string;
    onSuccess?: () => void;
};

// D6 (2026-11-20): the guest list is for the organisers only, so there's no "appear publicly" choice.
export const RSVP_DIALOG_PRIVACY_TEXT =
    "Only the organisers see who's attending. You can add a message for them if you like.";

export default function RsvpDialog({ open, onOpenChange, circleHandle, eventId, onSuccess }: Props) {
    const { toast } = useToast();
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const [message, setMessage] = useState<string>("");

    const onConfirm = () => {
        startTransition(async () => {
            const res = await rsvpEventWithOptionsAction(circleHandle, eventId, "going", {
                message: message.trim() || undefined,
            });
            if (res.success) {
                toast({ title: "RSVP updated" });
                onOpenChange(false);
                await onSuccess?.();
                router.refresh();
            } else {
                toast({
                    title: "Error",
                    description: res.message || "Failed to RSVP",
                    variant: "destructive",
                });
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[525px]">
                <DialogHeader>
                    <DialogTitle>RSVP: Attend</DialogTitle>
                    <DialogDescription>{RSVP_DIALOG_PRIVACY_TEXT}</DialogDescription>
                </DialogHeader>

                <div className="space-y-2 py-2">
                    <Label htmlFor="rsvp-message">Message to the organisers (optional)</Label>
                    <Textarea
                        id="rsvp-message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Add a short note…"
                        maxLength={500}
                        className="min-h-[90px]"
                    />
                    <div className="text-right text-xs text-muted-foreground">{message.length}/500</div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                        Cancel
                    </Button>
                    <Button onClick={onConfirm} disabled={isPending}>
                        {isPending ? "Saving…" : "Confirm"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
