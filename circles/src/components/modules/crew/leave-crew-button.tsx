// leave-crew-button.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { leaveCrewAction } from "./actions";

// Backlog item 2 (2026-11-25): Leave Crew was only reachable from a popover on your own avatar in
// the Crew list. The Crew card now has a visible Leave Crew button for Crew members; the avatar
// popover keeps its entry and opens the same dialog.

// Who sees the button: showsLeaveCrewButton (lib/peerify/crew-visibility.ts), checked in crew.tsx.

export const leaveCrewDescription = (circleName: string): string =>
    `You'll lose access to the Crew feed and Offers, and other Crew members won't see you in the list anymore. ` +
    `You'll still follow ${circleName} as normal, and can apply to rejoin Crew at any time.`;

type LeaveCrewDialogProps = {
    circleId: string;
    circleName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

// Controlled, so it can be opened from outside a Popover: nested inside PopoverContent it is
// unmounted when the Popover closes, before it can render (see crew-member-rail.tsx).
export const LeaveCrewDialog: React.FC<LeaveCrewDialogProps> = ({ circleId, circleName, open, onOpenChange }) => {
    const router = useRouter();
    const { toast } = useToast();
    const [isLeaving, setIsLeaving] = useState(false);

    // router.refresh() re-runs crew.tsx's server-side eligibility check with the updated
    // membership, which swaps the whole page over to CrewLanding.
    const onLeaveCrew = async () => {
        setIsLeaving(true);
        const res = await leaveCrewAction(circleId);
        setIsLeaving(false);
        if (res.success) {
            onOpenChange(false);
            router.refresh();
        } else {
            toast({ title: "Error", description: res.message, variant: "destructive" });
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Leave {circleName}&apos;s Crew?</AlertDialogTitle>
                    <AlertDialogDescription>{leaveCrewDescription(circleName)}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isLeaving}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={isLeaving}
                        onClick={(event) => {
                            // Keep the dialog open until the action answers (an error shows a toast).
                            event.preventDefault();
                            void onLeaveCrew();
                        }}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        {isLeaving ? "Leaving…" : "Leave Crew"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

type LeaveCrewButtonProps = {
    circleId: string;
    circleName: string;
};

const LeaveCrewButton: React.FC<LeaveCrewButtonProps> = ({ circleId, circleName }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-2 text-destructive hover:text-destructive"
                onClick={() => setIsOpen(true)}
                data-testid="leave-crew-button"
            >
                <LogOut className="h-3.5 w-3.5" />
                Leave Crew
            </Button>
            <LeaveCrewDialog circleId={circleId} circleName={circleName} open={isOpen} onOpenChange={setIsOpen} />
        </>
    );
};

export default LeaveCrewButton;
