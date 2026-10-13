"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { unpublishCircleAction } from "./actions";

type UnpublishCircleCardProps = {
    circleId: string;
    // "profile" for Peerify-managed identities, "circle" otherwise (same as the workflow card).
    entityLabel: string;
    upcomingEventCount: number;
    // Independent circles need verification again if their name or handle changes while in draft.
    needsVerificationToPublish: boolean;
};

// Shown on a published (non-personal) circle's About settings in place of the draft workflow card,
// which only renders while unpublished.
export function UnpublishCircleCard({
    circleId,
    entityLabel,
    upcomingEventCount,
    needsVerificationToPublish,
}: UnpublishCircleCardProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [isPending, startTransition] = useTransition();

    const handleUnpublish = () => {
        startTransition(async () => {
            const result = await unpublishCircleAction(circleId);
            if (!result.success) {
                toast({ title: "Couldn't move to draft", description: result.message, variant: "destructive" });
                return;
            }
            setIsOpen(false);
            toast({ title: "Moved back to draft", description: `This ${entityLabel} is no longer visible to others.` });
            router.refresh();
        });
    };

    return (
        <div className="mb-6 rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground">Status</span>
                        <Badge className="border-emerald-200 bg-emerald-100 text-emerald-900">Published</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        This {entityLabel} is live. You can move it back to draft to hide it again.
                    </p>
                </div>
                <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
                    Unpublish (back to draft)
                </Button>
            </div>

            <AlertDialog open={isOpen} onOpenChange={(open) => !isPending && setIsOpen(open)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Move this {entityLabel} back to draft?</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-3 text-sm text-muted-foreground">
                                <ul className="list-disc space-y-1 pl-5">
                                    <li>It will no longer appear in search, Discover or on the map.</li>
                                    <li>
                                        Links to it will show &quot;not found&quot; to everyone except you and its
                                        other admins and moderators.
                                    </li>
                                    <li>Followers and crew can&apos;t see it until you publish it again.</li>
                                    <li>Messages and chats already sent are not affected.</li>
                                </ul>
                                {upcomingEventCount > 0 ? (
                                    <p className="rounded-md border border-amber-200 bg-amber-50 p-3 font-medium text-amber-900">
                                        It has {upcomingEventCount} upcoming{" "}
                                        {upcomingEventCount === 1 ? "event" : "events"}. Those event pages and links
                                        will stop working, and the {upcomingEventCount === 1 ? "event" : "events"} will
                                        disappear from the events map and list.
                                    </p>
                                ) : null}
                                {needsVerificationToPublish ? (
                                    <p>
                                        You can publish it again without a new verification, as long as its name and
                                        handle stay the same. If either changes, it needs verification again.
                                    </p>
                                ) : (
                                    <p>You can publish it again at any time.</p>
                                )}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                        <Button type="button" variant="destructive" onClick={handleUnpublish} disabled={isPending}>
                            {isPending ? "Moving to draft..." : "Move to draft"}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
