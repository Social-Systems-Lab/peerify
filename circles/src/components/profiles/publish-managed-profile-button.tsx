"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { publishManagedPeerifyIdentityAction } from "@/app/profiles/actions";

type PublishManagedProfileButtonProps = {
    circleId: string;
    label?: string;
    size?: "default" | "sm";
    className?: string;
    // Server-computed: false when this is a pilot-signup-provisioned artist circle that
    // hasn't yet met the completion bar (picture, About text, map location, creator's
    // Community Guidelines signature) — see isPilotArtistCircleReadyToPublish in
    // src/lib/data/circle.ts. Disables the button here as a UX nicety; the server action
    // enforces the same bar regardless, so this can never be bypassed client-side.
    disabled?: boolean;
    disabledReason?: string;
};

export function PublishManagedProfileButton({
    circleId,
    label = "Publish profile",
    size = "sm",
    className,
    disabled,
    disabledReason,
}: PublishManagedProfileButtonProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [isPending, startTransition] = React.useTransition();

    const publishProfile = () => {
        startTransition(async () => {
            const result = await publishManagedPeerifyIdentityAction(circleId);
            toast({
                title: result.success ? "Profile published" : "Could not publish profile",
                description: result.message,
                variant: result.success ? "default" : "destructive",
                icon: result.success ? "success" : "error",
            });

            if (result.success) {
                router.refresh();
            }
        });
    };

    return (
        <Button
            type="button"
            size={size}
            className={className}
            onClick={publishProfile}
            disabled={isPending || disabled}
            title={disabled ? disabledReason : undefined}
        >
            {isPending ? "Publishing..." : label}
        </Button>
    );
}
