"use client";

import { useState } from "react";
import { useAtomValue } from "jotai";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { findOrCreateDMConversationAction, sendMongoMessageAction } from "@/components/modules/chat/actions";
import { userAtom } from "@/lib/data/atoms";
import type { Circle } from "@/models/models";

// The organiser messaging one guest from an event's guest list (event guests, 2026-11-20). The same
// DM actions as the Crew and Pledge dashboards; the server checks that the sender sees this event's
// guests and that the guest RSVPed, then records an event_guest grant (mayMessageEventGuest).
// The message comes from the organiser's own profile, not the venue (D2), and the dialog says so.
export const GUEST_CANT_REPLY_NOTE =
    "If they haven't completed their profile yet, they can read your message but can't reply until they do.";

export const fromYouText = (senderName?: string) =>
    senderName
        ? `They'll see this comes from you, ${senderName}. Only the two of you see the conversation.`
        : "They'll see this comes from you. Only the two of you see the conversation.";

type Props = {
    guest: Circle | null;
    circleId: string;
    eventId: string;
    onClose: () => void;
};

export default function MessageGuestDialog({ guest, circleId, eventId, onClose }: Props) {
    const { toast } = useToast();
    const user = useAtomValue(userAtom);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [isSending, setIsSending] = useState(false);

    const handleOpenChange = (open: boolean) => {
        if (open || isSending) return;
        setMessage("");
        setError("");
        onClose();
    };

    const handleSend = async () => {
        const trimmed = message.trim();
        if (!guest?.did || isSending) return;
        if (!trimmed) {
            setError("Please add a message before sending.");
            return;
        }

        setIsSending(true);
        setError("");
        try {
            const conversationResult = await findOrCreateDMConversationAction(
                { did: guest.did },
                { grantContext: { kind: "event_guest", circleId, eventId } },
            );
            const conversationId = conversationResult.chatRoom?._id || conversationResult.chatRoom?.handle;
            if (!conversationResult.success || !conversationId) {
                setError(conversationResult.message || "Could not start the conversation.");
                return;
            }

            const sendResult = await sendMongoMessageAction(conversationId, trimmed);
            if (!sendResult.success) {
                setError(sendResult.message || "Could not send the message.");
                return;
            }

            toast({ title: "Message sent", description: `Your message to ${guest.name || "this guest"} was sent.` });
            setMessage("");
            onClose();
        } catch (sendError) {
            console.error("Failed to send event guest message:", sendError);
            setError("Something went wrong. Please try again.");
        } finally {
            setIsSending(false);
        }
    };

    return (
        <Dialog open={guest !== null} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                {guest ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Message {guest.name || "this guest"}</DialogTitle>
                            <DialogDescription>{fromYouText(user?.name)}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2">
                            <Textarea
                                value={message}
                                onChange={(event) => {
                                    setMessage(event.target.value);
                                    if (error) setError("");
                                }}
                                rows={5}
                                placeholder="Write a short message..."
                                disabled={isSending}
                            />
                            <p className="text-xs text-muted-foreground">{GUEST_CANT_REPLY_NOTE}</p>
                            {error && <p className="text-sm text-destructive">{error}</p>}
                        </div>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => handleOpenChange(false)}
                                disabled={isSending}
                            >
                                Cancel
                            </Button>
                            <Button type="button" onClick={handleSend} disabled={isSending || !message.trim()}>
                                {isSending ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Sending...
                                    </>
                                ) : (
                                    "Send message"
                                )}
                            </Button>
                        </DialogFooter>
                    </>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
