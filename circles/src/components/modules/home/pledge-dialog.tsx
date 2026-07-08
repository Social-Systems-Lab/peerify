"use client";

import React from "react";
import { useAtom } from "jotai";
import { useRouter } from "next/navigation";
import { Circle } from "@/models/models";
import { userAtom } from "@/lib/data/atoms";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { sendPeerifyArtistEnquiryAction } from "@/components/modules/chat/mongo-actions";
import { createPeerifyPledgeAction } from "@/components/modules/home/peerify-pledge-actions";
import { isPeerifyManagedIdentity, PEERIFY_PLEDGE_HELP_OPTIONS } from "@/lib/peerify/artist-profile";

export type PledgeFormState = {
    fanLocation: string;
    maximumTicketAmount: string;
    preferredEventType: string;
    helpOptions: string[];
    note: string;
};

const EMPTY_PLEDGE_FORM: PledgeFormState = {
    fanLocation: "",
    maximumTicketAmount: "",
    preferredEventType: "",
    helpOptions: [],
    note: "",
};

type PledgeDialogProps = {
    circle: Circle;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export default function PledgeDialog({ circle, open, onOpenChange }: PledgeDialogProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [user] = useAtom(userAtom);
    const [pledgeForm, setPledgeForm] = React.useState<PledgeFormState>(EMPTY_PLEDGE_FORM);
    const [pledgeError, setPledgeError] = React.useState("");
    const [isSubmittingPledge, setIsSubmittingPledge] = React.useState(false);
    const isPeerifyManagedArtistIdentity = isPeerifyManagedIdentity(circle);

    React.useEffect(() => {
        if (open) {
            setPledgeError("");
        }
    }, [open]);

    const togglePledgeHelpOption = (option: string, checked: boolean) => {
        setPledgeForm((current) => ({
            ...current,
            helpOptions: checked
                ? Array.from(new Set([...current.helpOptions, option]))
                : current.helpOptions.filter((item) => item !== option),
        }));
    };

    const submitPledgeEnquiry = async () => {
        if (!user?.did) {
            router.push(`/login?redirectTo=${encodeURIComponent(`/circles/${circle.handle}/home`)}`);
            return;
        }

        setIsSubmittingPledge(true);
        setPledgeError("");

        try {
            if (isPeerifyManagedArtistIdentity) {
                const result = await createPeerifyPledgeAction({
                    artistCircleId: String(circle._id || ""),
                    pledge: pledgeForm,
                });

                if (!result.success) {
                    setPledgeError(result.message || "Could not add your pledge.");
                    return;
                }

                setPledgeForm(EMPTY_PLEDGE_FORM);
                onOpenChange(false);
                toast({
                    title: "Pledge added",
                    description: result.message || "Thanks — your pledge has been added to this artist's support map.",
                });
                router.refresh();
                return;
            }

            const result = await sendPeerifyArtistEnquiryAction({
                artistCircleId: String(circle._id || ""),
                enquiryType: "pledge",
                pledge: pledgeForm,
            });

            if (!result.success || !result.roomId) {
                setPledgeError(result.message || "Could not send your pledge enquiry.");
                return;
            }

            setPledgeForm(EMPTY_PLEDGE_FORM);
            onOpenChange(false);
            toast({
                title: "Pledge enquiry sent",
                description: "Your pledge enquiry has been sent to the artist.",
            });
            router.push(`/chat/${result.roomId}`);
        } catch (error) {
            console.error("Failed to send Peerify pledge enquiry:", error);
            setPledgeError("Could not submit your pledge. Please try again.");
        } finally {
            setIsSubmittingPledge(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                onOpenChange(nextOpen);
                if (!nextOpen) {
                    setPledgeError("");
                }
            }}
        >
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>Pledge interest for {circle.name}</DialogTitle>
                    <DialogDescription>
                        This is non-binding and not a ticket purchase. It helps signal local demand and support.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="space-y-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submitPledgeEnquiry();
                    }}
                >
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Input
                            placeholder="Your city / location"
                            value={pledgeForm.fanLocation}
                            onChange={(event) =>
                                setPledgeForm((current) => ({ ...current, fanLocation: event.target.value }))
                            }
                        />
                        <Input
                            placeholder="Maximum ticket amount"
                            type="number"
                            min="0"
                            value={pledgeForm.maximumTicketAmount}
                            onChange={(event) =>
                                setPledgeForm((current) => ({
                                    ...current,
                                    maximumTicketAmount: event.target.value,
                                }))
                            }
                        />
                    </div>
                    <Input
                        placeholder="Preferred event type"
                        value={pledgeForm.preferredEventType}
                        onChange={(event) =>
                            setPledgeForm((current) => ({ ...current, preferredEventType: event.target.value }))
                        }
                    />
                    <div className="space-y-2">
                        <Label>Willingness to help</Label>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {PEERIFY_PLEDGE_HELP_OPTIONS.map((option) => (
                                <label key={option} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                                    <Checkbox
                                        checked={pledgeForm.helpOptions.includes(option)}
                                        onCheckedChange={(checked) => togglePledgeHelpOption(option, checked === true)}
                                    />
                                    <span>{option}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <Textarea
                        rows={4}
                        placeholder="Optional note"
                        value={pledgeForm.note}
                        onChange={(event) => setPledgeForm((current) => ({ ...current, note: event.target.value }))}
                    />
                    {pledgeError && <p className="text-sm text-destructive">{pledgeError}</p>}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isSubmittingPledge}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isSubmittingPledge}>
                            {isSubmittingPledge
                                ? isPeerifyManagedArtistIdentity
                                    ? "Adding..."
                                    : "Sending..."
                                : isPeerifyManagedArtistIdentity
                                  ? "Add Pledge"
                                  : "Send Pledge Enquiry"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
