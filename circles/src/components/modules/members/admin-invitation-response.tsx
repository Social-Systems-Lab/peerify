"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRefreshUser } from "@/components/auth/use-refresh-user";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { CirclePicture } from "@/components/modules/circles/circle-picture";
import { acceptAdminInvitationAction, declineAdminInvitationAction } from "@/components/modules/members/actions";
import type { AdminInvitationForInvitee } from "@/lib/data/admin-invitations";

type Props = {
    invitation: AdminInvitationForInvitee;
};

// Accept/decline for the dedicated invitation page. AdminInvitationBanner does the same job on the
// circle's Followers page, but that page isn't reachable for an unpublished circle.
export default function AdminInvitationResponse({ invitation }: Props): React.ReactElement {
    const router = useRouter();
    const { toast } = useToast();
    const refreshUser = useRefreshUser();
    const [isPending, startTransition] = useTransition();
    const [decision, setDecision] = useState<"accept" | "decline" | null>(null);
    const [status, setStatus] = useState(invitation.status);
    const { circle, roleNames, inviterName, invalidReason } = invitation;

    const runAction = (nextDecision: "accept" | "decline") => {
        setDecision(nextDecision);
        startTransition(async () => {
            const result =
                nextDecision === "accept"
                    ? await acceptAdminInvitationAction(invitation.invitationId)
                    : await declineAdminInvitationAction(invitation.invitationId);

            if (result.success) {
                setStatus(nextDecision === "accept" ? "accepted" : "declined");
                if (nextDecision === "accept") {
                    await refreshUser();
                }
                router.refresh();
            } else {
                toast({
                    title: "Error",
                    description: result.message || "Request failed.",
                    variant: "destructive",
                });
            }

            setDecision(null);
        });
    };

    const renderBody = () => {
        switch (status) {
            case "accepted":
                return (
                    <>
                        <p className="text-[#6b5f52]">
                            You&apos;re now <span className="font-medium">{roleNames}</span> of{" "}
                            <span className="font-medium">{circle.name}</span>.
                        </p>
                        {circle.handle ? (
                            <Button asChild className="mt-6">
                                <Link href={`/circles/${circle.handle}`}>Go to {circle.name}</Link>
                            </Button>
                        ) : null}
                    </>
                );
            case "declined":
                return <p className="text-[#6b5f52]">You declined this invitation.</p>;
            case "cancelled":
                return <p className="text-[#6b5f52]">This invitation was cancelled.</p>;
            case "pending":
            default:
                return (
                    <>
                        <p className="text-[#6b5f52]">
                            <span className="font-medium">{inviterName}</span> invited you to become{" "}
                            <span className="font-medium">{roleNames}</span> of{" "}
                            <span className="font-medium">{circle.name}</span>. Accepting will make you a follower of
                            this circle with that role.
                        </p>
                        {invalidReason ? (
                            <p className="mt-4 text-[#6b5f52]">{invalidReason}</p>
                        ) : (
                            <div className="mt-6 flex flex-wrap justify-center gap-2">
                                <Button disabled={isPending} onClick={() => runAction("accept")}>
                                    {decision === "accept" ? "Accepting..." : "Accept"}
                                </Button>
                                <Button variant="outline" disabled={isPending} onClick={() => runAction("decline")}>
                                    {decision === "decline" ? "Declining..." : "Decline"}
                                </Button>
                            </div>
                        )}
                    </>
                );
        }
    };

    return (
        <Card className="w-full max-w-md border-[#e3d5c2] bg-[#faf6ef] shadow-sm">
            <CardContent className="flex flex-col items-center px-8 py-10 text-center">
                <CirclePicture circle={{ name: circle.name, picture: circle.picture }} size="64px" />
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.28em] text-[#e8720c]">
                    Admin invitation
                </p>
                <h1 className="mb-4 mt-2 text-2xl font-semibold text-[#181512]">{circle.name}</h1>
                {renderBody()}
            </CardContent>
        </Card>
    );
}
