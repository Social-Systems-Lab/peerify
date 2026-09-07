"use client";

import React, { useMemo, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import {
    accommodationSubTypes,
    OfferDetails,
    promotionChannels,
    TourTeamOffering,
    tourTeamOfferingTypes,
} from "@/models/models";
import {
    accommodationSubTypeLabels,
    getTourTeamOfferingIcon,
    OFFER_MODAL_TYPES,
    promotionChannelLabels,
    tourTeamOfferingTypeLabels,
} from "@/lib/data/tour-team-offerings";

type ModalOfferingType = (typeof OFFER_MODAL_TYPES)[number] | "custom";

interface CreateOfferModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    // Structured types offered in Step 1, already filtered for venue vs. personal circles by the
    // caller (OFFER_MODAL_TYPES or VENUE_OFFER_MODAL_TYPES). "Other" is always offered on top.
    allowedTypes: readonly (typeof OFFER_MODAL_TYPES)[number][];
    // Predefined types the circle already has an offering for — disabled in Step 1 since editing
    // an existing offering is out of scope for this pass (one offering per predefined type, same
    // invariant the old checkbox editor enforced).
    existingTypes: ReadonlySet<string>;
    onAdd: (offering: TourTeamOffering) => void;
}

export function CreateOfferModal({ open, onOpenChange, allowedTypes, existingTypes, onAdd }: CreateOfferModalProps) {
    const [step, setStep] = useState<1 | 2>(1);
    const [selectedType, setSelectedType] = useState<ModalOfferingType | null>(null);

    // Step 2 field state — a flat bag covering every type's fields is simpler than swapping
    // per-type form schemas for a single-use "add" form with no live preview yet; only the
    // fields relevant to `selectedType` are ever rendered or read at submit time.
    const [label, setLabel] = useState("");
    const [detail, setDetail] = useState("");
    const [accommodationType, setAccommodationType] = useState<(typeof accommodationSubTypes)[number] | "">("");
    const [maxStayNights, setMaxStayNights] = useState("");
    const [checkInFlexible, setCheckInFlexible] = useState(false);
    const [capacity, setCapacity] = useState("");
    const [spaceDescription, setSpaceDescription] = useState("");
    const [cuisine, setCuisine] = useState("");
    const [dietaryNotes, setDietaryNotes] = useState("");
    const [routeNotes, setRouteNotes] = useState("");
    const [channels, setChannels] = useState<string[]>([]);
    const [promotionNotes, setPromotionNotes] = useState("");

    const resetForm = () => {
        setStep(1);
        setSelectedType(null);
        setLabel("");
        setDetail("");
        setAccommodationType("");
        setMaxStayNights("");
        setCheckInFlexible(false);
        setCapacity("");
        setSpaceDescription("");
        setCuisine("");
        setDietaryNotes("");
        setRouteNotes("");
        setChannels([]);
        setPromotionNotes("");
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) resetForm();
        onOpenChange(nextOpen);
    };

    const selectType = (type: ModalOfferingType) => {
        setSelectedType(type);
        setStep(2);
    };

    const goBack = () => setStep(1);

    const isCustom = selectedType === "custom";
    const canSubmit = selectedType !== null && (!isCustom || label.trim().length > 0);

    const tiles = useMemo(
        () => [...allowedTypes.map((type) => ({ type: type as ModalOfferingType, isOther: false })), { type: "custom" as ModalOfferingType, isOther: true }],
        [allowedTypes],
    );

    const handleSubmit = () => {
        if (!selectedType || !canSubmit) return;

        let details: OfferDetails | undefined;
        switch (selectedType) {
            case "spare_room":
                details = {
                    type: "accommodation",
                    maxStayNights: maxStayNights ? Number(maxStayNights) : undefined,
                    checkInFlexible: checkInFlexible || undefined,
                };
                break;
            case "hosting_show":
                details = {
                    type: "hostingShow",
                    capacity: capacity ? Number(capacity) : undefined,
                    spaceDescription: spaceDescription.trim() || undefined,
                };
                break;
            case "home_cooked_meal":
                details = {
                    type: "meal",
                    cuisine: cuisine.trim() || undefined,
                    dietaryNotes: dietaryNotes.trim() || undefined,
                };
                break;
            case "local_transport":
                details = {
                    type: "transport",
                    routeNotes: routeNotes.trim() || undefined,
                };
                break;
            case "promotion":
                details = {
                    type: "promotion",
                    channels: channels.length ? (channels as (typeof promotionChannels)[number][]) : undefined,
                    notes: promotionNotes.trim() || undefined,
                };
                break;
            case "custom":
                details = undefined;
                break;
        }

        const offering: TourTeamOffering = {
            id: crypto.randomUUID(),
            type: selectedType as TourTeamOffering["type"],
            label: isCustom ? label.trim() : undefined,
            detail: isCustom ? detail.trim() || undefined : undefined,
            accommodationType:
                selectedType === "spare_room" && accommodationType ? accommodationType : undefined,
            details,
            // Photo picker lands in a follow-up commit — no photos collected yet.
            photos: undefined,
        };

        onAdd(offering);
        handleOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Create an offer</DialogTitle>
                    <DialogDescription>
                        {step === 1
                            ? "What can you offer to visiting artists?"
                            : selectedType === "custom"
                              ? "Describe your offer."
                              : `Add details for ${selectedType ? tourTeamOfferingTypeLabels[selectedType as (typeof tourTeamOfferingTypes)[number]] : ""}.`}
                    </DialogDescription>
                </DialogHeader>

                {step === 1 && (
                    <div className="grid grid-cols-2 gap-3 py-2 sm:grid-cols-3">
                        {tiles.map(({ type, isOther }) => {
                            const alreadyAdded = !isOther && existingTypes.has(type);
                            const Icon = isOther ? Sparkles : getTourTeamOfferingIcon({ type });
                            const tileLabel = isOther
                                ? "Other"
                                : tourTeamOfferingTypeLabels[type as (typeof tourTeamOfferingTypes)[number]];
                            return (
                                <button
                                    key={type}
                                    type="button"
                                    disabled={alreadyAdded}
                                    onClick={() => selectType(type)}
                                    className={cn(
                                        "flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-center text-sm transition",
                                        alreadyAdded
                                            ? "cursor-not-allowed border-dashed opacity-50"
                                            : "hover:border-primary hover:bg-primary/5",
                                    )}
                                >
                                    <Icon className="h-6 w-6" />
                                    <span>{tileLabel}</span>
                                    {alreadyAdded && <span className="text-xs text-muted-foreground">Already added</span>}
                                </button>
                            );
                        })}
                    </div>
                )}

                {step === 2 && selectedType && (
                    <div className="space-y-4 py-2">
                        {isCustom && (
                            <div className="space-y-2">
                                <Label htmlFor="offer-label">What are you offering? *</Label>
                                <Input
                                    id="offer-label"
                                    value={label}
                                    onChange={(e) => setLabel(e.target.value)}
                                    placeholder="e.g. Instrument loan"
                                    maxLength={60}
                                />
                            </div>
                        )}

                        {selectedType === "spare_room" && (
                            <>
                                <div className="space-y-2">
                                    <Label>What kind of space?</Label>
                                    <Select
                                        value={accommodationType}
                                        onValueChange={(v) => setAccommodationType(v as (typeof accommodationSubTypes)[number])}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Optional" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {accommodationSubTypes.map((subType) => (
                                                <SelectItem key={subType} value={subType}>
                                                    {accommodationSubTypeLabels[subType]}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="offer-max-stay">Max stay (nights)</Label>
                                    <Input
                                        id="offer-max-stay"
                                        type="number"
                                        min={1}
                                        value={maxStayNights}
                                        onChange={(e) => setMaxStayNights(e.target.value)}
                                        placeholder="Optional"
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="offer-checkin-flexible">Flexible check-in</Label>
                                    <Switch
                                        id="offer-checkin-flexible"
                                        checked={checkInFlexible}
                                        onCheckedChange={setCheckInFlexible}
                                    />
                                </div>
                            </>
                        )}

                        {selectedType === "hosting_show" && (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="offer-capacity">Rough capacity</Label>
                                    <Input
                                        id="offer-capacity"
                                        type="number"
                                        min={1}
                                        value={capacity}
                                        onChange={(e) => setCapacity(e.target.value)}
                                        placeholder="Optional"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="offer-space-description">Tell us about the space</Label>
                                    <Textarea
                                        id="offer-space-description"
                                        value={spaceDescription}
                                        onChange={(e) => setSpaceDescription(e.target.value)}
                                        maxLength={300}
                                        placeholder="Optional"
                                    />
                                </div>
                            </>
                        )}

                        {selectedType === "home_cooked_meal" && (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="offer-cuisine">Cuisine</Label>
                                    <Input
                                        id="offer-cuisine"
                                        value={cuisine}
                                        onChange={(e) => setCuisine(e.target.value)}
                                        maxLength={100}
                                        placeholder="Optional"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="offer-dietary-notes">Dietary notes</Label>
                                    <Textarea
                                        id="offer-dietary-notes"
                                        value={dietaryNotes}
                                        onChange={(e) => setDietaryNotes(e.target.value)}
                                        maxLength={300}
                                        placeholder="Optional"
                                    />
                                </div>
                            </>
                        )}

                        {selectedType === "local_transport" && (
                            <div className="space-y-2">
                                <Label htmlFor="offer-route-notes">Route notes</Label>
                                <Textarea
                                    id="offer-route-notes"
                                    value={routeNotes}
                                    onChange={(e) => setRouteNotes(e.target.value)}
                                    maxLength={300}
                                    placeholder="Optional — e.g. usual routes, how far you can go"
                                />
                            </div>
                        )}

                        {selectedType === "promotion" && (
                            <>
                                <div className="space-y-2">
                                    <Label>Channels</Label>
                                    <ToggleGroup type="multiple" value={channels} onValueChange={setChannels} className="flex-wrap justify-start">
                                        {promotionChannels.map((channel) => (
                                            <ToggleGroupItem key={channel} value={channel} className="text-xs">
                                                {promotionChannelLabels[channel]}
                                            </ToggleGroupItem>
                                        ))}
                                    </ToggleGroup>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="offer-promotion-notes">Anything else?</Label>
                                    <Textarea
                                        id="offer-promotion-notes"
                                        value={promotionNotes}
                                        onChange={(e) => setPromotionNotes(e.target.value)}
                                        maxLength={300}
                                        placeholder="Optional"
                                    />
                                </div>
                            </>
                        )}

                        {isCustom && (
                            <div className="space-y-2">
                                <Label htmlFor="offer-detail">Anything else?</Label>
                                <Textarea
                                    id="offer-detail"
                                    value={detail}
                                    onChange={(e) => setDetail(e.target.value)}
                                    maxLength={300}
                                    placeholder="Optional"
                                />
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter>
                    {step === 2 && (
                        <Button type="button" variant="outline" onClick={goBack}>
                            Back
                        </Button>
                    )}
                    {step === 2 && (
                        <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
                            Add offer
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
