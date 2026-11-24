"use client";

import { useCallback, useEffect, useState } from "react";
import { useAtom } from "jotai";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { userAtom } from "@/lib/data/atoms";
import { canSendConnectionRequest, UNVERIFIED_PROFILE_EXPLAINER } from "@/lib/auth/verification";
import type { RelationshipConnectStatus } from "@/lib/data/relationships";
import {
    acceptConnectRequestAction,
    declineConnectRequestAction,
    getConnectStatusesAction,
    sendConnectRequestAction,
    withdrawConnectRequestAction,
} from "./actions";

// Connect on a personal profile's limited version, the page and the preview (Tim, 2026-11-24).
// Signed in only, never for the owner (who never gets the limited version). The safeguards are on
// the server, in the same actions the full profile and the DM banner use: verified senders only,
// 20 requests a day, a silent decline (the sender keeps seeing "Requested"). The status comes from
// getConnectStatusesAction, the viewer's own request status and nothing else about the person.
// Accepting their request refreshes the page, which then shows the full profile.

// Only the status, nothing else about the person.
export const loadLimitedConnectStatus = async (targetDid: string): Promise<RelationshipConnectStatus> =>
    (await getConnectStatusesAction([targetDid]))[targetDid] ?? "none";

type Handlers = {
    onConnect: () => void;
    onWithdraw: () => void;
    onAccept: () => void;
    onDecline: () => void;
};

export function LimitedProfileConnectControls({
    status,
    canSend,
    busy,
    onConnect,
    onWithdraw,
    onAccept,
    onDecline,
}: { status: RelationshipConnectStatus | null; canSend: boolean; busy: boolean } & Handlers) {
    if (!status || status === "accepted") return null;
    if (status === "pending_received") {
        return (
            <div className="flex flex-row items-center justify-center gap-2">
                <Button size="sm" className="rounded-full" disabled={busy} onClick={onAccept}>
                    Accept
                </Button>
                <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={onDecline}>
                    Decline
                </Button>
            </div>
        );
    }
    if (status === "pending_sent") {
        return (
            <div className="flex flex-row items-center justify-center gap-2">
                <span className="text-sm text-gray-600">Requested</span>
                <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={onWithdraw}>
                    Withdraw
                </Button>
            </div>
        );
    }
    // Unverified viewers see Connect greyed out; pressing it explains why (as on the full profile).
    // The recipient of a request sees the sender's full profile while they decide (2026-11-24).
    return (
        <div className="flex flex-col items-center gap-1">
            <Button
                size="sm"
                className={canSend ? "rounded-full" : "rounded-full opacity-50"}
                aria-disabled={canSend ? undefined : true}
                disabled={busy}
                onClick={onConnect}
            >
                Connect
            </Button>
            <p className="text-xs text-gray-500">They&apos;ll see your profile while they decide.</p>
        </div>
    );
}

export function LimitedProfileConnect({ targetDid }: { targetDid: string }) {
    const [user] = useAtom(userAtom);
    const router = useRouter();
    const { toast } = useToast();
    const [status, setStatus] = useState<RelationshipConnectStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const isOwn = !user?.did || user.did === targetDid;

    useEffect(() => {
        if (isOwn) return;
        let isCurrent = true;
        loadLimitedConnectStatus(targetDid)
            .then((next) => {
                if (isCurrent) setStatus(next);
            })
            .catch(() => undefined);
        return () => {
            isCurrent = false;
        };
    }, [isOwn, targetDid]);

    const run = useCallback(
        async (
            title: string,
            action: () => Promise<{ success: boolean; message: string; connected?: boolean }>,
            next: RelationshipConnectStatus,
        ) => {
            setBusy(true);
            try {
                const result = await action();
                if (!result.success) {
                    toast({ title, description: result.message, variant: "destructive" });
                    return;
                }
                if (next === "accepted" || result.connected) {
                    setStatus("accepted");
                    router.refresh();
                    return;
                }
                setStatus(next);
            } catch {
                toast({ title, description: "Something went wrong. Please try again.", variant: "destructive" });
            } finally {
                setBusy(false);
            }
        },
        [router, toast],
    );

    if (isOwn) return null;
    const canSend = canSendConnectionRequest(user);

    return (
        <div className="mt-4" data-limited-connect="" data-can-connect={canSend ? "true" : "false"}>
            <LimitedProfileConnectControls
                status={status}
                canSend={canSend}
                busy={busy}
                onConnect={() => {
                    if (!canSend) {
                        toast({ title: "Connect", description: UNVERIFIED_PROFILE_EXPLAINER });
                        return;
                    }
                    void run("Connect", () => sendConnectRequestAction(targetDid), "pending_sent");
                }}
                onWithdraw={() => void run("Withdraw", () => withdrawConnectRequestAction(targetDid), "none")}
                onAccept={() => void run("Accept", () => acceptConnectRequestAction(targetDid), "accepted")}
                onDecline={() => void run("Decline", () => declineConnectRequestAction(targetDid), "none")}
            />
        </div>
    );
}
