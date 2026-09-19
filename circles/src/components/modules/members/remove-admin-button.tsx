"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";
import { hasHigherAccess, isAuthorized } from "@/lib/auth/client-auth";
import { features } from "@/lib/data/constants";
import { updateUserGroupsAction } from "@/components/modules/members/actions";
import { Circle, MemberDisplay } from "@/models/models";

type Props = {
    circle: Circle;
    admin: MemberDisplay;
};

// closed -> (self target) warn-self -> confirm -> closed. Non-self targets skip straight to
// confirm, matching the single "Are you sure?" step members-table.tsx already uses for
// removeMemberAction - the extra warn-self step is the "at minimum, extra confirmation" the self-
// removal case needs, since updateUserGroupsAction applies a self-demotion immediately (no
// admin-role-removal-request indirection - you don't need to ask your own permission).
type Step = "closed" | "warn-self" | "confirm";

type Acknowledgement = { title: string; body: string };

export default function RemoveAdminButton({ circle, admin }: Props) {
    const [user] = useAtom(userAtom);
    const router = useRouter();
    const { toast } = useToast();
    const [step, setStep] = useState<Step>("closed");
    const [isPending, startTransition] = useTransition();
    const [acknowledgement, setAcknowledgement] = useState<Acknowledgement | null>(null);

    // Same gate + same-level comparison members-table.tsx already uses to decide whether to show
    // its own Edit User Groups/Remove row actions - hasHigherAccess(user, self, circle, true)
    // resolves true (equal access levels), which is what lets a self-service demotion show at all.
    const canEditUserGroups =
        isAuthorized(user, circle, features.general.edit_lower_user_groups) ||
        isAuthorized(user, circle, features.general.edit_same_level_user_groups);
    const canEditSameLevel = isAuthorized(user, circle, features.general.edit_same_level_user_groups);
    const canRemove = canEditUserGroups && hasHigherAccess(user, admin, circle, canEditSameLevel);
    const isSelf = user?.did === admin.userDid;

    if (!canRemove) {
        return null;
    }

    const onConfirm = () => {
        startTransition(async () => {
            const newGroups = (admin.userGroups ?? []).filter((group) => group !== "admins");
            const result = await updateUserGroupsAction(admin, circle, newGroups);

            if (result.success) {
                if (result.adminRoleRemovalRequestState === "created") {
                    setAcknowledgement({
                        title: "Admin removal request created",
                        body: `${admin.name} will keep their admin access until they approve this request.\nThey have been notified and will see the request on this circle's Followers page.`,
                    });
                } else if (result.adminRoleRemovalRequestState === "pending") {
                    setAcknowledgement({
                        title: "Admin removal request already pending",
                        body: `${admin.name} already has a pending request to approve before their admin role can be removed.`,
                    });
                } else {
                    toast({
                        icon: "success",
                        title: "Removed",
                        description: result.message || `${admin.name} is no longer an admin.`,
                    });
                    router.refresh();
                }
            } else {
                toast({
                    icon: "error",
                    title: "Error",
                    description: result.message,
                    variant: "destructive",
                });
            }

            setStep("closed");
        });
    };

    return (
        <>
            <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setStep(isSelf ? "warn-self" : "confirm")}
            >
                Remove admin
            </Button>

            <Dialog open={step === "warn-self"} onOpenChange={(open) => !open && setStep("closed")}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Remove your own admin access?</DialogTitle>
                        <DialogDescription>
                            You&apos;re about to remove your own Admin role in {circle.name}. Unless you hold
                            another role that gives you access, you&apos;ll lose the ability to manage this circle
                            until another admin invites you back.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button variant="destructive" onClick={() => setStep("confirm")}>
                            Continue
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={step === "confirm"} onOpenChange={(open) => !open && setStep("closed")}>
                <DialogContent onInteractOutside={(e) => e.preventDefault()}>
                    <DialogHeader>
                        <DialogTitle>Are you sure?</DialogTitle>
                        <DialogDescription>
                            {isSelf ? (
                                <>Remove your own Admin role in {circle.name}?</>
                            ) : (
                                <>
                                    Remove the Admin role from <b>{admin.name}</b>?
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
                            {isPending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Removing...
                                </>
                            ) : (
                                <>Remove</>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={acknowledgement !== null} onOpenChange={(open) => !open && setAcknowledgement(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{acknowledgement?.title}</DialogTitle>
                        <DialogDescription className="whitespace-pre-line">{acknowledgement?.body}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button onClick={() => setAcknowledgement(null)}>OK</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
