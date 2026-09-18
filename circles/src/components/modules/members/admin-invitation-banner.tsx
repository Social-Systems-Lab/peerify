"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Circle } from "@/models/models";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { acceptAdminInvitationAction, declineAdminInvitationAction } from "@/components/modules/members/actions";

type AdminInvitationBannerProps = {
    circle: Circle;
    requestId: string;
    inviterName?: string;
    roleNames: string;
};

export default function AdminInvitationBanner({
    circle,
    requestId,
    inviterName,
    roleNames,
}: AdminInvitationBannerProps): React.ReactElement {
    const router = useRouter();
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [decision, setDecision] = useState<"accept" | "decline" | null>(null);

    const runAction = (nextDecision: "accept" | "decline") => {
        setDecision(nextDecision);
        startTransition(async () => {
            const result =
                nextDecision === "accept"
                    ? await acceptAdminInvitationAction(requestId, circle)
                    : await declineAdminInvitationAction(requestId, circle);

            toast({
                title: result.success ? "Updated" : "Error",
                description: result.message || "Request failed.",
                variant: result.success ? undefined : "destructive",
            });

            if (result.success) {
                router.refresh();
            }

            setDecision(null);
        });
    };

    return (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="space-y-3">
                <div className="space-y-1">
                    <h2 className="text-base font-semibold text-amber-950">Admin invitation</h2>
                    <p className="text-sm text-amber-900">
                        You&apos;ve been invited to become <span className="font-medium">{roleNames}</span> of{" "}
                        <span className="font-medium">{circle.name}</span>. Accepting will make you a follower of
                        this circle with that role.
                    </p>
                    {inviterName ? (
                        <p className="text-sm text-amber-900">
                            Invited by: <span className="font-medium">{inviterName}</span>
                        </p>
                    ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" disabled={isPending} onClick={() => runAction("accept")}>
                        {decision === "accept" ? "Accepting..." : "Accept"}
                    </Button>
                    <Button variant="destructive" disabled={isPending} onClick={() => runAction("decline")}>
                        {decision === "decline" ? "Declining..." : "Decline"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
