"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { CirclePicture } from "@/components/modules/circles/circle-picture";
import { findOrCreateDMConversationAction, sendMongoMessageAction } from "@/components/modules/chat/actions";
import { accommodationSubTypeLabels, getTourTeamOfferingIcon, getTourTeamOfferingLabel } from "@/lib/data/tour-team-offerings";
import type { Circle, Location, MemberDisplay, TourTeamOffering } from "@/models/models";
import { Loader2 } from "lucide-react";
import { TbMessage } from "react-icons/tb";

export type CrewRosterMember = MemberDisplay & { tourTeamOfferings: TourTeamOffering[] };

const formatDate = (date?: Date): string =>
    date
        ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(date))
        : "-";

const getLocationLabel = (location?: Location): string =>
    [location?.city, location?.region, location?.country].filter(Boolean).join(", ") || "Location not set";

type CrewDashboardClientProps = {
    members: CrewRosterMember[];
};

export function CrewDashboardClient({ members }: CrewDashboardClientProps) {
    const [messageMember, setMessageMember] = useState<CrewRosterMember | null>(null);

    return (
        <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {members.map((member) => (
                    <CrewMemberCard key={member.userDid} member={member} onMessage={() => setMessageMember(member)} />
                ))}
            </div>

            <MessageComposeDialog
                member={messageMember}
                onOpenChange={(open) => {
                    if (!open) setMessageMember(null);
                }}
            />
        </div>
    );
}

function CrewMemberCard({ member, onMessage }: { member: CrewRosterMember; onMessage: () => void }) {
    return (
        <Card className="rounded-lg border-slate-200 bg-white shadow-none">
            <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-3">
                    <CirclePicture circle={{ name: member.name, picture: member.picture }} size="40px" />
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-[#231f1a]">{member.name || "Unknown member"}</div>
                        {member.handle ? (
                            <div className="truncate text-xs text-muted-foreground">@{member.handle}</div>
                        ) : null}
                    </div>
                </div>

                <div className="text-sm text-slate-500">{getLocationLabel(member.location)}</div>
                <div className="text-xs text-slate-500">Joined {formatDate(member.joinedAt)}</div>

                <div>
                    <div className="mb-1 text-xs font-medium uppercase text-slate-500">Offering to help</div>
                    {member.tourTeamOfferings.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                            {member.tourTeamOfferings.map((offering) => {
                                const OfferingIcon = getTourTeamOfferingIcon(offering);
                                return (
                                    <Badge key={offering.id} variant="offering" className="gap-1">
                                        <OfferingIcon className="h-3 w-3" />
                                        {getTourTeamOfferingLabel(offering)}
                                        {offering.accommodationType &&
                                            ` · ${accommodationSubTypeLabels[offering.accommodationType]}`}
                                    </Badge>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-xs text-slate-500">No offerings shared yet.</p>
                    )}
                    <p className="mt-1.5 text-xs text-muted-foreground">
                        General standing offer to help touring artists — not specific to your tour.
                    </p>
                </div>

                <Button type="button" variant="outline" size="sm" className="mt-1 w-fit gap-2" onClick={onMessage}>
                    <TbMessage className="h-4 w-4" />
                    Message
                </Button>
            </CardContent>
        </Card>
    );
}

function MessageComposeDialog({
    member,
    onOpenChange,
}: {
    member: CrewRosterMember | null;
    onOpenChange: (open: boolean) => void;
}) {
    const { toast } = useToast();
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [isSending, setIsSending] = useState(false);

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setMessage("");
            setError("");
        }
        onOpenChange(open);
    };

    const handleSend = async () => {
        const trimmed = message.trim();
        if (!member?.userDid || isSending) {
            return;
        }
        if (!trimmed) {
            setError("Please add a message before sending.");
            return;
        }

        setIsSending(true);
        setError("");
        try {
            // Same generic DM actions the Pledge Dashboard already uses (source: "profile" skips
            // the contacts-only eligibility gate) — no new messaging infrastructure needed here.
            const recipient: Circle = { did: member.userDid };
            const conversationResult = await findOrCreateDMConversationAction(recipient, { source: "profile" });
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

            toast({ title: "Message sent", description: `Your message to ${member.name || "this member"} was sent.` });
            handleOpenChange(false);
        } catch (error) {
            console.error("Failed to send Crew member message:", error);
            setError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
        } finally {
            setIsSending(false);
        }
    };

    return (
        <Dialog open={member !== null} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                {member ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Message {member.name || "this member"}</DialogTitle>
                            <DialogDescription>
                                This sends a direct message — a private conversation between just the two of you.
                            </DialogDescription>
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
                                    "Send Message"
                                )}
                            </Button>
                        </DialogFooter>
                    </>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
