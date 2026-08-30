"use client";

import React from "react";
import { useAtom } from "jotai";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Circle } from "@/models/models";
import { userAtom } from "@/lib/data/atoms";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { sendPeerifyArtistEnquiryAction } from "@/components/modules/chat/mongo-actions";
import { createPeerifyPledgeAction } from "@/components/modules/home/peerify-pledge-actions";
import {
    getPeerifyArtistProfile,
    isPeerifyArtistIdentity,
    isPeerifyManagedIdentity,
    PEERIFY_PLEDGE_HELP_OPTIONS,
} from "@/lib/peerify/artist-profile";
import { getCrewMembershipStatusAction } from "@/components/modules/crew/actions";
import JoinCrewDialog from "@/components/modules/home/join-crew-dialog";

export type PledgeFormState = {
    fanLocation: string;
    maximumTicketAmount: string;
    preferredEventType: string;
    helpOptions: string[];
    // Only meaningful when helpOptions includes "Host" — see the reveal field below. Replaces the
    // old standalone "Space for 20-30 people" checkbox.
    hostingCapacity: string;
    note: string;
};

const EMPTY_PLEDGE_FORM: PledgeFormState = {
    fanLocation: "",
    maximumTicketAmount: "",
    preferredEventType: "",
    helpOptions: [],
    hostingCapacity: "",
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
    const [isHelpOptionsOpen, setIsHelpOptionsOpen] = React.useState(false);
    const [isJoinCrewDialogOpen, setIsJoinCrewDialogOpen] = React.useState(false);
    // Same fresh-read-on-mount approach as content-preview.tsx/home-content.tsx's identical
    // check (see getCrewMembershipStatusAction) — not derived from the client-side userAtom,
    // which never refreshes after login and so can't reflect an approval that happened in a
    // different session.
    const [crewMembershipStatus, setCrewMembershipStatus] = React.useState<"approved" | "pending" | "none">("none");
    const isPeerifyManagedArtistIdentity = isPeerifyManagedIdentity(circle);
    const canJoinCrew = isPeerifyArtistIdentity(circle) && circle.crewEnabled !== false;
    const userLocationText = user?.location
        ? [user.location.city, user.location.region, user.location.country].filter(Boolean).join(", ")
        : "";
    // Display-only fallback — never written back to the artist's own profile data, just what
    // this popup shows next to the ticket-amount input when the artist hasn't configured one.
    const artistCurrency = getPeerifyArtistProfile(circle).bookingSettings.currency || "EUR";

    React.useEffect(() => {
        if (open) {
            setPledgeError("");
        }
    }, [open]);

    React.useEffect(() => {
        if (open && userLocationText) {
            setPledgeForm((current) => (current.fanLocation ? current : { ...current, fanLocation: userLocationText }));
        }
    }, [open, userLocationText]);

    React.useEffect(() => {
        if (!open || !canJoinCrew || !user?.did || !circle?._id) {
            return;
        }
        let isCurrent = true;
        getCrewMembershipStatusAction(circle._id ?? "").then((result) => {
            if (isCurrent) setCrewMembershipStatus(result.status);
        });
        return () => {
            isCurrent = false;
        };
    }, [open, canJoinCrew, circle, user?.did]);

    const openJoinCrewDialog = () => {
        if (!user?.did) {
            router.push(`/login?redirectTo=${encodeURIComponent(`/circles/${circle.handle}/home`)}`);
            return;
        }
        setIsJoinCrewDialogOpen(true);
    };

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
        <>
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
                            A pledge is not a ticket purchase. It helps signal local demand and support.
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
                            <div className="space-y-1">
                                <Input
                                    placeholder="Your city / location"
                                    value={pledgeForm.fanLocation}
                                    onChange={(event) =>
                                        setPledgeForm((current) => ({ ...current, fanLocation: event.target.value }))
                                    }
                                />
                                {userLocationText && (
                                    <Button
                                        type="button"
                                        variant="link"
                                        className="h-auto p-0 text-xs"
                                        onClick={() => setPledgeForm((current) => ({ ...current, fanLocation: "" }))}
                                    >
                                        Select different location?
                                    </Button>
                                )}
                            </div>
                            {/* self-start: without it, this row gets vertically centered within the
                                grid cell once the location column grows taller (the "Select different
                                location?" link appearing below it) — self-start pins it to the same
                                top edge as the location input instead of drifting toward mid-height. */}
                            <div className="flex items-center gap-2 self-start">
                                <span className="flex h-10 shrink-0 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                                    {artistCurrency}
                                </span>
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
                        </div>
                        <Input
                            placeholder="Event type"
                            value={pledgeForm.preferredEventType}
                            onChange={(event) =>
                                setPledgeForm((current) => ({ ...current, preferredEventType: event.target.value }))
                            }
                        />
                        <Collapsible open={isHelpOptionsOpen} onOpenChange={setIsHelpOptionsOpen}>
                            <CollapsibleTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="flex w-full items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-left text-sm font-medium text-stone-700 hover:bg-stone-100"
                                >
                                    <span>
                                        Contribute to tour
                                        {pledgeForm.helpOptions.length > 0 ? ` (${pledgeForm.helpOptions.length})` : ""}
                                    </span>
                                    <ChevronDown
                                        className={cn(
                                            "h-4 w-4 transition-transform",
                                            isHelpOptionsOpen && "rotate-180",
                                        )}
                                    />
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-3">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {PEERIFY_PLEDGE_HELP_OPTIONS.map((option) => (
                                        <label
                                            key={option}
                                            className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                                        >
                                            <Checkbox
                                                checked={pledgeForm.helpOptions.includes(option)}
                                                onCheckedChange={(checked) =>
                                                    togglePledgeHelpOption(option, checked === true)
                                                }
                                            />
                                            <span>{option}</span>
                                        </label>
                                    ))}
                                </div>
                                {/* Same automatic reveal pattern as Booking enquiries' dependent
                                    fields — driven by the "Host" checkbox itself, no separate
                                    trigger. Replaces the old standalone "Space for 20-30 people"
                                    checkbox with a free-text field that still reaches the same
                                    downstream consumers (Pledge Dashboard, chat-enquiry message). */}
                                <Collapsible open={pledgeForm.helpOptions.includes("Host")}>
                                    <CollapsibleContent className="pt-3">
                                        <Input
                                            placeholder="Approximate capacity (e.g. 20-30 people)"
                                            value={pledgeForm.hostingCapacity}
                                            onChange={(event) =>
                                                setPledgeForm((current) => ({
                                                    ...current,
                                                    hostingCapacity: event.target.value,
                                                }))
                                            }
                                        />
                                    </CollapsibleContent>
                                </Collapsible>
                            </CollapsibleContent>
                        </Collapsible>
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
                            <Button
                                type="submit"
                                className="bg-[#FE801B] text-white hover:bg-[#e57316]"
                                disabled={isSubmittingPledge}
                            >
                                {isSubmittingPledge
                                    ? isPeerifyManagedArtistIdentity
                                        ? "Adding..."
                                        : "Sending..."
                                    : isPeerifyManagedArtistIdentity
                                      ? "Add Pledge"
                                      : "Send Pledge Enquiry"}
                            </Button>
                        </DialogFooter>
                        {/* Separated from Cancel/Add Pledge on purpose — someone opening this dialog has
                            already shown intent, making this the highest-relevance moment to prompt Crew
                            membership. Hidden entirely (not just the "apply" state) when the artist has
                            turned Crew off — same convention as the Pledge/Crew button row on the map
                            popup and full artist page (content-preview.tsx/home-content.tsx). */}
                        {canJoinCrew && (
                            <div className="flex justify-center pt-1">
                                {crewMembershipStatus === "approved" ? (
                                    <Button
                                        asChild
                                        className="bg-[#1A1612] text-white hover:bg-[#2b2621]"
                                        onClick={() => onOpenChange(false)}
                                    >
                                        <Link href={`/circles/${circle.handle}/crew`}>View Crew</Link>
                                    </Button>
                                ) : crewMembershipStatus === "pending" ? (
                                    <Button
                                        type="button"
                                        disabled
                                        className="bg-[#1A1612] text-white hover:bg-[#2b2621]"
                                    >
                                        Application Pending
                                    </Button>
                                ) : (
                                    <Button
                                        type="button"
                                        className="bg-[#1A1612] text-white hover:bg-[#2b2621]"
                                        onClick={openJoinCrewDialog}
                                    >
                                        Join Crew
                                    </Button>
                                )}
                            </div>
                        )}
                    </form>
                </DialogContent>
            </Dialog>
            {canJoinCrew && (
                <JoinCrewDialog
                    circle={circle}
                    open={isJoinCrewDialogOpen}
                    onOpenChange={setIsJoinCrewDialogOpen}
                    onApplied={() => setCrewMembershipStatus("pending")}
                />
            )}
        </>
    );
}
