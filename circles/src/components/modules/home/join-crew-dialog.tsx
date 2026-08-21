"use client";

import React, { useState, useTransition } from "react";
import { useAtom } from "jotai";
import { useRouter } from "next/navigation";
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
import { userAtom } from "@/lib/data/atoms";
import { Circle } from "@/models/models";
import { applyForCrewMembership } from "@/components/modules/home/actions";
import { CirclePicture } from "@/components/modules/circles/circle-picture";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    circle: Circle;
    // Optimistic same-tab update, mirroring follow-button.tsx's pattern for membership changes
    // the current tab itself just caused. Needed because the caller's crew-status check only
    // re-runs on mount (see getCrewMembershipStatusAction) — router.refresh() alone doesn't
    // re-trigger it, so without this the button would still show "Join Crew" until the next
    // full reload even though the application was just sent successfully.
    onApplied?: () => void;
};

export default function JoinCrewDialog({ open, onOpenChange, circle, onApplied }: Props) {
    const { toast } = useToast();
    const router = useRouter();
    const [user] = useAtom(userAtom);
    const [isPending, startTransition] = useTransition();
    const [message, setMessage] = useState<string>("");

    const onSubmit = () => {
        if (!user?.did) {
            router.push(`/login?redirectTo=${encodeURIComponent(`/circles/${circle.handle}/home`)}`);
            return;
        }

        startTransition(async () => {
            const res = await applyForCrewMembership(circle, message.trim());
            if (res.success) {
                toast({ title: "Crew application sent", description: res.message });
                setMessage("");
                onOpenChange(false);
                onApplied?.();
                router.refresh();
            } else {
                toast({
                    title: "Error",
                    description: res.message || "Failed to submit your Crew application",
                    variant: "destructive",
                });
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[525px]">
                <DialogHeader>
                    <DialogTitle>Join {circle.name}&apos;s Crew</DialogTitle>
                    <DialogDescription>
                        Crew members actively support the artist — advice, local knowledge, spreading the word, and
                        more.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="flex items-start gap-3 rounded-md border p-3">
                        <CirclePicture circle={circle} size="40px" />
                        <p className="text-sm text-muted-foreground">
                            Thanks for wanting to help support us on tour! Tell us a bit about how you&apos;d like to
                            get involved and we&apos;ll be in touch.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="crew-application-message">How can I help?</Label>
                        <Textarea
                            id="crew-application-message"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="Share how you'd like to support the Crew…"
                            maxLength={1000}
                            className="min-h-[120px]"
                        />
                        <div className="text-right text-xs text-muted-foreground">{message.length}/1000</div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                        Cancel
                    </Button>
                    <Button onClick={onSubmit} disabled={isPending || !message.trim()}>
                        {isPending ? "Sending…" : "Send application"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
