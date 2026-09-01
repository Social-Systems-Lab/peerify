"use client";

import React from "react";
import { useAtom } from "jotai";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Circle, Location } from "@/models/models";
import { userAtom } from "@/lib/data/atoms";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import LocationPicker from "@/components/forms/location-picker";
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
import { createPeerifyPledgeAction, getMyPeerifyPledgeAction } from "@/components/modules/home/peerify-pledge-actions";
import {
    isPeerifyArtistIdentity,
    isPeerifyManagedIdentity,
    PEERIFY_CURRENCY_OPTIONS,
    PEERIFY_PLEDGE_HELP_OPTIONS,
} from "@/lib/peerify/artist-profile";
import { getCurrencyForCountryCode } from "@/lib/peerify/country-currency";
import { getCrewMembershipStatusAction } from "@/components/modules/crew/actions";
import JoinCrewDialog from "@/components/modules/home/join-crew-dialog";

export type PledgeFormState = {
    fanLocation: string;
    maximumTicketAmount: string;
    // Fan's own choice, defaulted from their location (see handleFanLocationChange) but always
    // editable and always decoupled from the artist's own booking-settings currency.
    currency: string;
    // preferredEventType intentionally dropped — no longer collected (see the removed "Event
    // type" input below). PeerifyPledgeEnquiryInput still declares it optional so this form state
    // stays assignable there without it; historical pledge records keep whatever value they
    // already have, and both downstream readers (Pledge Dashboard, chat-enquiry message) already
    // render a blank/missing value gracefully.
    helpOptions: string[];
    // Only meaningful when helpOptions includes "Host" — see the reveal field below. Replaces the
    // old standalone "Space for 20-30 people" checkbox.
    hostingCapacity: string;
    note: string;
};

const EMPTY_PLEDGE_FORM: PledgeFormState = {
    fanLocation: "",
    maximumTicketAmount: "",
    currency: "",
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
    // Whether this fan already has a pledge on file for this artist — drives the pre-fill below
    // and the "editing, not creating" copy/labels. One pledge per (artist, fan): a resubmit
    // updates the existing record in place (see createPeerifyPledge's upsert), so without this the
    // dialog would reopen blank and a resubmit would silently overwrite fields the fan didn't
    // bother re-entering.
    const [hasExistingPledge, setHasExistingPledge] = React.useState(false);
    // Distinguishes "haven't checked yet" from "checked, and there isn't one" — the location
    // fallback effect below must wait for this, otherwise it briefly prefills the picker with the
    // fan's own profile location before the existing-pledge check resolves, and LocationPicker's
    // marker never gets cleared back off the map once that value is reverted (it only ever moves
    // the marker to a new lngLat, never removes it for a value going back to undefined).
    const [hasCheckedExistingPledge, setHasCheckedExistingPledge] = React.useState(false);
    const [isJoinCrewDialogOpen, setIsJoinCrewDialogOpen] = React.useState(false);
    // Same fresh-read-on-mount approach as content-preview.tsx/home-content.tsx's identical
    // check (see getCrewMembershipStatusAction) — not derived from the client-side userAtom,
    // which never refreshes after login and so can't reflect an approval that happened in a
    // different session.
    const [crewMembershipStatus, setCrewMembershipStatus] = React.useState<"approved" | "pending" | "none">("none");
    // Structured location backing the LocationPicker below — kept separate from
    // pledgeForm.fanLocation (a plain display string, still what's actually persisted) because
    // an existing pledge only has that string, not a re-usable Location object; see the
    // "Currently set to" hint rendered when this is undefined but fanLocation isn't empty.
    const [fanLocationValue, setFanLocationValue] = React.useState<Location | undefined>(undefined);
    // Once the fan touches the currency dropdown directly, stop overwriting it every time the
    // location changes — a ref (not state) since it's read inside handleFanLocationChange and
    // must never itself trigger a re-render.
    const currencyManuallyEditedRef = React.useRef(false);
    const isPeerifyManagedArtistIdentity = isPeerifyManagedIdentity(circle);
    const canJoinCrew = isPeerifyArtistIdentity(circle) && circle.crewEnabled !== false;

    React.useEffect(() => {
        if (open) {
            setPledgeError("");
        }
    }, [open]);

    // Structured pledges only (isPeerifyManagedArtistIdentity) — the chat-enquiry fallback path
    // for other circles never persists a re-editable record, so there's nothing to pre-fill from.
    React.useEffect(() => {
        if (!open) {
            setHasExistingPledge(false);
            setHasCheckedExistingPledge(false);
            return;
        }
        if (!isPeerifyManagedArtistIdentity) {
            // No structured-pledge concept for this circle type (chat-enquiry fallback path) —
            // nothing to wait for, so the location fallback effect below is free to run right away.
            setHasExistingPledge(false);
            setHasCheckedExistingPledge(true);
            return;
        }
        setHasCheckedExistingPledge(false);
        let isCurrent = true;
        getMyPeerifyPledgeAction(String(circle._id || "")).then((result) => {
            if (!isCurrent) return;
            setHasCheckedExistingPledge(true);
            if (result.pledge) {
                setHasExistingPledge(true);
                setPledgeForm({
                    fanLocation: result.pledge.fanLocation,
                    maximumTicketAmount: result.pledge.maximumTicketAmount,
                    currency: result.pledge.currency || "",
                    helpOptions: result.pledge.helpOptions,
                    hostingCapacity: result.pledge.hostingCapacity,
                    note: result.pledge.note,
                });
                // The existing pledge only has a display string, not a structured Location the
                // picker can show a pin/search value for — leave it blank rather than guess.
                // fanLocation itself is untouched above, so a resubmit that doesn't touch the
                // picker still submits the fan's original location text unchanged.
                setFanLocationValue(undefined);
                // Editing an existing choice counts as "manual" — a location re-pick here
                // shouldn't silently override a currency the fan already deliberately set.
                currencyManuallyEditedRef.current = Boolean(result.pledge.currency);
                if (result.pledge.helpOptions.length > 0) {
                    setIsHelpOptionsOpen(true);
                }
            } else {
                setHasExistingPledge(false);
            }
        });
        return () => {
            isCurrent = false;
        };
    }, [open, isPeerifyManagedArtistIdentity, circle]);

    // Profile-location fallback for a genuinely new pledge only — waits for the existing-pledge
    // check above to actually finish (not just "not yet known to be true") before prefilling,
    // otherwise this briefly sets the picker's value and its map marker never gets cleared back
    // off once the real check comes back positive and reverts it (see hasCheckedExistingPledge).
    // user.location is already a structured Location (set via this same LocationPicker
    // elsewhere, e.g. onboarding), so it can prefill the picker directly — unlike an existing
    // pledge's plain fanLocation string.
    React.useEffect(() => {
        if (open && user?.location && hasCheckedExistingPledge && !hasExistingPledge) {
            setPledgeForm((current) => {
                if (current.fanLocation) {
                    return current;
                }
                const displayText = [user.location?.city, user.location?.region, user.location?.country]
                    .filter(Boolean)
                    .join(", ");
                return { ...current, fanLocation: displayText };
            });
            setFanLocationValue((current) => current ?? user.location);
        }
    }, [open, user?.location, hasCheckedExistingPledge, hasExistingPledge]);

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

    const handleFanLocationChange = (location: Location) => {
        setFanLocationValue(location);
        const displayText = [location.city, location.region, location.country].filter(Boolean).join(", ");
        setPledgeForm((current) => ({ ...current, fanLocation: displayText }));

        if (!currencyManuallyEditedRef.current) {
            const derivedCurrency = getCurrencyForCountryCode(location.countryCode);
            if (derivedCurrency) {
                setPledgeForm((current) => ({ ...current, currency: derivedCurrency }));
            }
        }
    };

    const handleCurrencyChange = (currency: string) => {
        currencyManuallyEditedRef.current = true;
        setPledgeForm((current) => ({ ...current, currency }));
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
                    title: hasExistingPledge ? "Pledge updated" : "Pledge added",
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
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
                    <DialogHeader>
                        <DialogTitle>Pledge interest for {circle.name}</DialogTitle>
                        <DialogDescription>
                            {hasExistingPledge
                                ? "You've already pledged — update it below."
                                : "A pledge is not a ticket purchase. It helps signal local demand and support."}
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="space-y-4"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void submitPledgeEnquiry();
                        }}
                    >
                        <div className="space-y-2">
                            <Label>Your city / location</Label>
                            <LocationPicker value={fanLocationValue} onChange={handleFanLocationChange} compact />
                            {/* The picker itself can't show a pin/search text for an existing
                                pledge's plain-string location (see the pre-fill effect above) —
                                surface what's still actually going to be submitted so it doesn't
                                look like no location is set. */}
                            {!fanLocationValue && pledgeForm.fanLocation && (
                                <p className="text-xs text-muted-foreground">
                                    Currently set to: {pledgeForm.fanLocation}. Search above to change it.
                                </p>
                            )}
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Currency</Label>
                                <select
                                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={pledgeForm.currency}
                                    onChange={(event) => handleCurrencyChange(event.target.value)}
                                >
                                    {PEERIFY_CURRENCY_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label>Maximum ticket amount</Label>
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
                                        ? hasExistingPledge
                                            ? "Updating..."
                                            : "Adding..."
                                        : "Sending..."
                                    : isPeerifyManagedArtistIdentity
                                      ? hasExistingPledge
                                          ? "Update Pledge"
                                          : "Add Pledge"
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
