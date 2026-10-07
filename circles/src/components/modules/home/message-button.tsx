"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { userAtom } from "@/lib/data/atoms";
import { Circle, ConnectionRequestResolution } from "@/models/models";
import { useAtom } from "jotai";
import {
    acceptConnectRequestAction,
    declineConnectRequestAction,
    getProfileRelationshipStateAction,
    sendConnectRequestAction,
    withdrawConnectRequestAction,
} from "./actions";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import { useIsCompact } from "@/components/utils/use-is-compact";
import { ChevronDown, Loader2 } from "lucide-react";
import { TbMessage } from "react-icons/tb";
import { useRouter } from "next/navigation";
import { findOrCreateDMConversationAction } from "../chat/actions";
import { canPerformRestrictedAction, UNVERIFIED_PROFILE_EXPLAINER } from "@/lib/auth/verification";
import type { DmEligibilityReason } from "@/lib/data/relationships";

type MessageButtonProps = {
    circle: Circle;
    renderCompact?: boolean;
};

export type RelationshipState = {
    connectStatus: "none" | "pending_sent" | "pending_received" | "accepted";
    dmAllowed: boolean;
    showConnect: boolean;
    connectLabel: "Connect" | "Requested" | "Requested You" | null;
    messageVisibilityReason: DmEligibilityReason;
    connectLabelReason: "pending_sent" | "pending_received" | "contact_not_established" | "contact_established";
};

// Personal-profile header actions, by relationship:
// - connected: Message
// - not connected: Connect (plus Message if a legacy DM or grant still allows messaging)
// - request sent: "Requested", whose menu offers Withdraw request
// - request received: nothing here; ProfileRelationshipHeaderAction shows Accept / Decline
// Viewers who aren't verified see Connect greyed out; pressing it explains why.
export const MessageButton = ({ circle, renderCompact }: MessageButtonProps) => {
    const [user] = useAtom(userAtom);
    const router = useRouter();
    const isCompact = useIsCompact();
    const compact = isCompact || renderCompact;
    const { toast } = useToast();
    const [relationshipState, reloadRelationshipState] = useProfileRelationshipState(circle, user?.did);
    const [isOpeningMessage, setIsOpeningMessage] = useState(false);
    const [isSendingConnect, setIsSendingConnect] = useState(false);
    const [isWithdrawing, setIsWithdrawing] = useState(false);

    if (!circle || !user?.did || circle.did === user.did || circle.circleType !== "user" || !relationshipState) {
        return null;
    }

    const canSendConnectRequest = canPerformRestrictedAction(user);
    const connectButtonClassName = compact ? "rounded-full px-3" : "rounded-full";

    const handleConnectRequest = async () => {
        if (!circle?.did || isSendingConnect) {
            return;
        }

        if (!canSendConnectRequest) {
            toast({ title: "Connect", description: UNVERIFIED_PROFILE_EXPLAINER });
            return;
        }

        setIsSendingConnect(true);
        try {
            const result = await sendConnectRequestAction(circle.did);

            if (!result.success) {
                toast({
                    title: "Connect",
                    description: result.message,
                });
                return;
            }

            await reloadRelationshipState();
            router.refresh();

            toast(
                result.connected
                    ? { title: "You're now connected", description: "Messaging is now available for this connection." }
                    : { title: "Connection request sent", description: "This profile now shows as Requested." },
            );
        } catch (error) {
            console.error("Failed to send connect request:", error);
            toast({
                title: "Connect",
                description: "Failed to send connection request",
            });
        } finally {
            setIsSendingConnect(false);
        }
    };

    const handleWithdrawRequest = async () => {
        if (!circle?.did || isWithdrawing) {
            return;
        }

        setIsWithdrawing(true);
        try {
            const result = await withdrawConnectRequestAction(circle.did);
            if (!result.success) {
                toast({ title: "Withdraw request", description: result.message });
                return;
            }

            await reloadRelationshipState();
            router.refresh();
            toast({ title: "Connection request withdrawn" });
        } catch (error) {
            console.error("Failed to withdraw connect request:", error);
            toast({ title: "Withdraw request", description: "Failed to withdraw connection request" });
        } finally {
            setIsWithdrawing(false);
        }
    };

    const handleMessageClick = async () => {
        if (!circle?.did || isOpeningMessage) {
            return;
        }

        setIsOpeningMessage(true);
        try {
            const result = await findOrCreateDMConversationAction(circle);
            const conversationId = result.chatRoom?._id || result.chatRoom?.handle;
            if (!result.success || !conversationId) {
                toast({
                    title: "Message",
                    description: result.message || "Could not open the direct message",
                    variant: "destructive",
                });
                return;
            }

            router.push(`/chat/${conversationId}`);
        } catch (error) {
            console.error("Failed to open profile DM:", error);
            toast({
                title: "Message",
                description: error instanceof Error ? error.message : "Could not open the direct message",
                variant: "destructive",
            });
        } finally {
            setIsOpeningMessage(false);
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            {relationshipState.dmAllowed && (
                <Button
                    variant="outline"
                    className="gap-2 rounded-full"
                    data-message-reason={relationshipState.messageVisibilityReason}
                    disabled={isOpeningMessage}
                    onClick={() => void handleMessageClick()}
                >
                    {isOpeningMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <TbMessage className="h-4 w-4" />}
                    {isOpeningMessage ? "Opening..." : "Message"}
                </Button>
            )}
            {relationshipState.connectStatus === "none" && (
                <Button
                    variant={relationshipState.dmAllowed ? "ghost" : "outline"}
                    size={compact ? "sm" : "default"}
                    className={cn(connectButtonClassName, !canSendConnectRequest && "opacity-50")}
                    data-connect-reason={relationshipState.connectLabelReason}
                    aria-disabled={!canSendConnectRequest}
                    title={canSendConnectRequest ? undefined : UNVERIFIED_PROFILE_EXPLAINER}
                    disabled={isSendingConnect}
                    onClick={() => void handleConnectRequest()}
                >
                    {isSendingConnect ? "Sending..." : "Connect"}
                </Button>
            )}
            {relationshipState.connectStatus === "pending_sent" && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="outline"
                            size={compact ? "sm" : "default"}
                            className={cn(connectButtonClassName, "text-muted-foreground")}
                            data-connect-reason={relationshipState.connectLabelReason}
                            disabled={isWithdrawing}
                        >
                            {isWithdrawing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                            Requested
                            <ChevronDown className="ml-1 h-3.5 w-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        <DropdownMenuItem onSelect={() => void handleWithdrawRequest()}>Withdraw request</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
};

const CONNECTION_OUTCOME_LABELS: Record<ConnectionRequestResolution, string> = {
    accepted: "Accepted",
    declined: "Declined",
    withdrawn: "No longer pending",
};

// Static outcome for a connection request notification that's no longer actionable.
export const ConnectionOutcomeLabel = ({ resolution }: { resolution: ConnectionRequestResolution }) => (
    <span
        className={
            resolution === "accepted"
                ? "inline-flex h-7 items-center rounded-full border border-[#c7d8cb] bg-[#f3f7f4] px-3 text-xs font-medium text-[#45604d]"
                : "inline-flex h-7 items-center rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-600"
        }
    >
        {CONNECTION_OUTCOME_LABELS[resolution]}
    </span>
);

export const ProfileRelationshipHeaderAction = ({
    circle,
    pendingOnly,
    showOutcome,
    onResolved,
}: {
    circle: Circle;
    // Notification rows with no stored resolution (sent before it existed): when the request is no
    // longer pending, show a static outcome from the live state instead of nothing. Live state
    // can't tell a decline from a withdrawal, so anything but accepted reads "No longer pending".
    showOutcome?: boolean;
    // Called after a successful accept or decline, so the caller can refresh.
    onResolved?: () => void;
    // When true, only render the Accept / Decline controls (pending_received).
    // Skips the "Connected" badge so this can sit alongside MessageButton, which already
    // renders its own "Connected" badge for the accepted state.
    pendingOnly?: boolean;
}) => {
    const [user] = useAtom(userAtom);
    const router = useRouter();
    const { toast } = useToast();
    const [relationshipState, reloadRelationshipState] = useProfileRelationshipState(circle, user?.did);
    const [isAcceptingConnect, setIsAcceptingConnect] = useState(false);
    const [isDecliningConnect, setIsDecliningConnect] = useState(false);

    if (!circle?.did || !user?.did || circle.did === user.did || circle.circleType !== "user" || !relationshipState) {
        return null;
    }

    const isResponding = isAcceptingConnect || isDecliningConnect;

    const handleAcceptRequest = async () => {
        if (!circle?.did || isResponding) {
            return;
        }

        setIsAcceptingConnect(true);
        try {
            const result = await acceptConnectRequestAction(circle.did);
            if (!result.success) {
                toast({
                    title: "Accept connection",
                    description: result.message,
                });
                return;
            }

            await reloadRelationshipState();
            router.refresh();
            onResolved?.();

            toast({
                title: "Connection accepted",
                description: "Messaging is now available for this connection.",
            });
        } catch (error) {
            console.error("Failed to accept connect request:", error);
            toast({
                title: "Accept connection",
                description: "Failed to accept connection request",
            });
        } finally {
            setIsAcceptingConnect(false);
        }
    };

    const handleDeclineRequest = async () => {
        if (!circle?.did || isResponding) {
            return;
        }

        setIsDecliningConnect(true);
        try {
            const result = await declineConnectRequestAction(circle.did);
            if (!result.success) {
                toast({
                    title: "Decline request",
                    description: result.message,
                });
                return;
            }

            await reloadRelationshipState();
            router.refresh();
            onResolved?.();

            toast({
                title: "Connection request declined",
                description: "The request was cleared.",
            });
        } catch (error) {
            console.error("Failed to decline connect request:", error);
            toast({
                title: "Decline request",
                description: "Failed to decline connection request",
            });
        } finally {
            setIsDecliningConnect(false);
        }
    };

    if (relationshipState.connectLabelReason === "pending_received") {
        return (
            <div className="flex items-center gap-1">
                <Button
                    variant="default"
                    size="sm"
                    className="rounded-full bg-amber-500 text-white shadow-sm hover:bg-amber-600 focus-visible:ring-amber-400"
                    disabled={isResponding}
                    onClick={() => void handleAcceptRequest()}
                >
                    {isAcceptingConnect ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    Accept
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={isResponding}
                    onClick={() => void handleDeclineRequest()}
                >
                    {isDecliningConnect ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    Decline
                </Button>
            </div>
        );
    }

    if (showOutcome) {
        return (
            <ConnectionOutcomeLabel resolution={relationshipState.connectStatus === "accepted" ? "accepted" : "withdrawn"} />
        );
    }

    if (!pendingOnly && relationshipState.connectStatus === "accepted") {
        return (
            <Badge className="inline-flex h-8 items-center rounded-full border border-[#c7d8cb] bg-[#f3f7f4] px-3 py-1 text-[#45604d] hover:bg-[#f3f7f4]">
                Connected
            </Badge>
        );
    }

    return null;
};

export const useProfileRelationshipState = (circle: Circle, viewerDid?: string) => {
    const [relationshipState, setRelationshipState] = useState<RelationshipState | null>(null);
    const relationshipRequestRef = useRef(0);

    const mapRelationshipState = useCallback(
        (state: Awaited<ReturnType<typeof getProfileRelationshipStateAction>>) =>
            state
                ? {
                      connectStatus: state.connectStatus,
                      dmAllowed: state.dmAllowed,
                      showConnect: state.showConnect,
                      connectLabel: state.connectLabel,
                      messageVisibilityReason: state.messageVisibilityReason,
                      connectLabelReason: state.connectLabelReason,
                  }
                : null,
        [],
    );

    const loadRelationshipState = useCallback(async (requestId: number, targetDid: string) => {
        try {
            const state = await getProfileRelationshipStateAction(targetDid);
            if (relationshipRequestRef.current !== requestId) {
                return;
            }

            setRelationshipState(mapRelationshipState(state));
        } catch (error) {
            if (relationshipRequestRef.current !== requestId) {
                return;
            }

            console.error("Failed to load relationship state:", error);
            setRelationshipState(null);
        }
    }, [mapRelationshipState]);

    const reloadRelationshipState = useCallback(async () => {
        if (!viewerDid || !circle?.did || circle.did === viewerDid || circle.circleType !== "user") {
            relationshipRequestRef.current += 1;
            setRelationshipState(null);
            return;
        }

        const requestId = ++relationshipRequestRef.current;
        await loadRelationshipState(requestId, circle.did);
    }, [circle?.circleType, circle?.did, loadRelationshipState, viewerDid]);

    useEffect(() => {
        relationshipRequestRef.current += 1;
        setRelationshipState(null);

        if (!viewerDid || !circle?.did || circle.did === viewerDid || circle.circleType !== "user") {
            return;
        }

        const requestId = relationshipRequestRef.current;
        void loadRelationshipState(requestId, circle.did);

        return () => {
            relationshipRequestRef.current += 1;
        };
    }, [circle?.did, circle?.circleType, loadRelationshipState, viewerDid]);

    useEffect(() => {
        const handleVisibilityRefresh = () => {
            if (document.visibilityState === "visible") {
                void reloadRelationshipState();
            }
        };

        const handleFocusRefresh = () => {
            void reloadRelationshipState();
        };

        window.addEventListener("focus", handleFocusRefresh);
        document.addEventListener("visibilitychange", handleVisibilityRefresh);

        return () => {
            window.removeEventListener("focus", handleFocusRefresh);
            document.removeEventListener("visibilitychange", handleVisibilityRefresh);
        };
    }, [reloadRelationshipState]);

    return [relationshipState, reloadRelationshipState] as const;
};

export default MessageButton;
