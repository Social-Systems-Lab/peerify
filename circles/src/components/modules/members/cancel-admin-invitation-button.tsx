"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";
import { cancelAdminInvitationAction } from "@/components/modules/members/actions";
import { Circle } from "@/models/models";

type Props = {
    circle: Circle;
    requestId: string;
    inviteeName: string;
};

// Inline two-step confirm rather than RemoveAdminButton's Dialog: cancelling takes nothing away
// from anyone (the invitee has no access yet - see cancelAdminInvitation, which just deletes the
// still-pending doc), so a modal overstates it. The second click still guards against retracting
// an invite by a stray click on a row, which a bare one-click button wouldn't.
export default function CancelAdminInvitationButton({ circle, requestId, inviteeName }: Props) {
    const router = useRouter();
    const { toast } = useToast();
    const [isConfirming, setIsConfirming] = useState(false);
    const [isPending, startTransition] = useTransition();

    const onConfirm = () => {
        startTransition(async () => {
            const result = await cancelAdminInvitationAction(requestId, circle);

            if (result.success) {
                toast({
                    icon: "success",
                    title: "Invitation cancelled",
                    description: `${inviteeName} can no longer accept this invitation.`,
                });
                router.refresh();
            } else {
                toast({
                    icon: "error",
                    title: "Error",
                    description: result.message || "Could not cancel this invitation.",
                    variant: "destructive",
                });
            }

            setIsConfirming(false);
        });
    };

    if (!isConfirming) {
        return (
            <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setIsConfirming(true)}
            >
                Cancel invite
            </Button>
        );
    }

    return (
        <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={isPending} onClick={() => setIsConfirming(false)}>
                Keep
            </Button>
            <Button variant="destructive" size="sm" disabled={isPending} onClick={onConfirm}>
                {isPending ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Cancelling...
                    </>
                ) : (
                    <>Confirm</>
                )}
            </Button>
        </div>
    );
}
