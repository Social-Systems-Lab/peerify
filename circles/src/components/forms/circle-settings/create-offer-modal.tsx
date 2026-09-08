"use client";

import React, { useLayoutEffect, useMemo, useState } from "react";
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
import { MultiImageUploader, ImageItem } from "@/components/forms/controls/multi-image-uploader";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import {
    accommodationSubTypes,
    Media,
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

// No EXIF-stripping on these uploads yet (deliberately deferred — see SESSION_LOG.md 2026-09-07,
// a flagged privacy follow-up, not a forgotten TODO). This nudge is a cheap, immediate mitigation
// in the meantime: steer people away from shots that would reveal identifying/location details in
// the first place.
const ACCOMMODATION_PHOTO_NUDGE =
    "Show the room or interior — avoid the building's exterior, street signs, or house numbers that could reveal your address.";
const GENERIC_PHOTO_NUDGE = "Avoid faces and other identifying details.";

type ModalOfferingType = (typeof OFFER_MODAL_TYPES)[number] | "custom";

interface CreateOfferModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    // Structured types offered in Step 1, already filtered for venue vs. personal circles by the
    // caller (OFFER_MODAL_TYPES or VENUE_OFFER_MODAL_TYPES). "Other" is always offered on top.
    allowedTypes: readonly (typeof OFFER_MODAL_TYPES)[number][];
    // Predefined types the circle already has an offering for — disabled in Step 1 since Step 1
    // is create-only (see editingOffering below); one offering per predefined type, same invariant
    // the old checkbox editor enforced.
    existingTypes: ReadonlySet<string>;
    onAdd: (offering: TourTeamOffering) => void;
    onSave: (offering: TourTeamOffering) => void;
    // Non-null opens the modal straight to Step 2, pre-filled from this offering, type locked (no
    // Step 1 grid, no Back) — editing an offering reuses the same two-step form, it just skips
    // choosing a type since that's already decided. Pass null/undefined for the "Add an offer" flow.
    editingOffering?: TourTeamOffering | null;
}

const EMPTY_IMAGES: ImageItem[] = [];

type OfferPhotoLike = {
    url?: string;
    fileName?: string;
    originalName?: string;
    file?: File;
    preview?: string;
    existingMediaUrl?: string;
};

// TourTeamOffering.photos is typed as fileInfoSchema[] (the persisted shape — `{url, fileName?,
// originalName?}`), but at runtime it can still be MultiImageUploader's draft ImageItem shape
// (`{id, file, preview}`, no `.url` at all) if this offering was added/edited via the modal's own
// "Add offer"/"Update" button and has never yet been through the page's real Save Changes
// button — that's what actually round-trips it through savePresence/resolveOfferingPhotos into a
// real FileInfo. Both seeding helpers below have to check for this at runtime rather than trust
// the type: assuming `.url` is always present produced `{preview: undefined}` seeds (a broken
// image in the picker) for exactly this "edit before the offering's first real save" case.
function isResolvedOfferPhoto(photo: OfferPhotoLike): photo is { url: string; fileName?: string; originalName?: string } {
    return typeof photo.url === "string";
}

// TourTeamOffering.photos is persisted as fileInfoSchema[], but MultiImageUploader's
// `initialImages` prop wants the Media[] shape (Circle.images/Event.images's own shape) — wrap
// each saved photo in a throwaway Media envelope just so the uploader can read `.fileInfo.url`.
function offeringPhotosToMediaSeed(photos: TourTeamOffering["photos"]): Media[] {
    if (!photos?.length) return [];
    return (photos as unknown as OfferPhotoLike[]).flatMap((photo) => {
        if (isResolvedOfferPhoto(photo)) {
            return [{ name: photo.originalName || "offer-photo", type: "image", fileInfo: photo }];
        }
        // Still a draft — seed the picker's display from its blob preview instead of a
        // nonexistent `.url`, so it shows the pending upload instead of rendering broken.
        return photo.preview ? [{ name: "offer-photo", type: "image", fileInfo: { url: photo.preview } }] : [];
    });
}

// Also seed this component's own `photos` draft state directly (not just the uploader's internal
// display) — MultiImageUploader never calls `onChange` for its initial seed, so without this an
// untouched edit (user opens the modal, changes an unrelated field, saves) would submit an EMPTY
// photos array and silently wipe out the offering's existing photos.
function offeringPhotosToImageItems(photos: TourTeamOffering["photos"]): ImageItem[] {
    if (!photos?.length) return [];
    return (photos as unknown as OfferPhotoLike[]).map((photo) =>
        isResolvedOfferPhoto(photo)
            ? { id: photo.url, preview: photo.url, existingMediaUrl: photo.url }
            : // Still a draft — already shaped exactly like ImageItem, pass through unchanged so
              // an untouched submit still uploads the pending file correctly.
              (photo as unknown as ImageItem),
    );
}

export function CreateOfferModal({
    open,
    onOpenChange,
    allowedTypes,
    existingTypes,
    onAdd,
    onSave,
    editingOffering,
}: CreateOfferModalProps) {
    const isEditing = Boolean(editingOffering);

    const [step, setStep] = useState<1 | 2>(1);
    const [selectedType, setSelectedType] = useState<TourTeamOffering["type"] | null>(null);
    const [photos, setPhotos] = useState<ImageItem[]>(EMPTY_IMAGES);

    // Step 2 field state — a flat bag covering every type's fields is simpler than swapping
    // per-type form schemas for a single-use "add/edit" form with no live preview yet; only the
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

    // `photos` in particular isn't type-scoped in the data model — without clearing it here,
    // picking a type, uploading photos, hitting Back, and picking a *different* type would
    // silently carry the first type's photos onto the second type's offering (MultiImageUploader
    // itself remounts empty since it only ever seeds from `initialImages` at mount, but this
    // component's own `photos` state would still hold the stale array underneath it).
    const resetStepTwoFields = () => {
        setPhotos(EMPTY_IMAGES);
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

    const resetForm = () => {
        setStep(1);
        setSelectedType(null);
        resetStepTwoFields();
    };

    // Seeds Step 2 directly from `editingOffering` whenever the modal opens in edit mode, or
    // resets to a blank Step 1 otherwise. Keyed on `open` (not `editingOffering`) since that's the
    // only thing that actually transitions while this component's instance is shared between the
    // "Add an offer" and per-card edit flows — see OfferManager. useLayoutEffect (not useEffect) so
    // the seeded state commits before paint, avoiding a one-frame flash of Step 1 or blank fields
    // when opening straight into an edit.
    useLayoutEffect(() => {
        if (!open) return;
        if (!editingOffering) {
            resetForm();
            return;
        }

        resetStepTwoFields();
        setSelectedType(editingOffering.type);
        setStep(2);
        setLabel(editingOffering.label || "");
        setDetail(editingOffering.detail || "");
        setAccommodationType(editingOffering.accommodationType || "");
        setPhotos(offeringPhotosToImageItems(editingOffering.photos));

        const details = editingOffering.details;
        switch (details?.type) {
            case "accommodation":
                setMaxStayNights(details.maxStayNights ? String(details.maxStayNights) : "");
                setCheckInFlexible(Boolean(details.checkInFlexible));
                break;
            case "hostingShow":
                setCapacity(details.capacity ? String(details.capacity) : "");
                setSpaceDescription(details.spaceDescription || "");
                break;
            case "meal":
                setCuisine(details.cuisine || "");
                setDietaryNotes(details.dietaryNotes || "");
                break;
            case "transport":
                setRouteNotes(details.routeNotes || "");
                break;
            case "promotion":
                setChannels(details.channels ? [...details.channels] : []);
                setPromotionNotes(details.notes || "");
                break;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) resetForm();
        onOpenChange(nextOpen);
    };

    const selectType = (type: ModalOfferingType) => {
        resetStepTwoFields();
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
            default:
                // "custom", plus any legacy type with no Step 2 form of its own (city_guide,
                // sound_equipment_help) — editable via the generic detail/photos fields only.
                details = undefined;
                break;
        }

        const offering: TourTeamOffering = {
            id: editingOffering?.id ?? crypto.randomUUID(),
            type: selectedType,
            label: isCustom ? label.trim() : undefined,
            detail: detail.trim() || undefined,
            accommodationType:
                selectedType === "spare_room" && accommodationType ? accommodationType : undefined,
            details,
            // Persisted as fileInfoSchema[] — resolved from these ImageItem drafts (new File
            // uploads, or kept `existingMediaUrl` entries) when the Presence settings form is
            // saved. See savePresence (settings/presence/actions.ts).
            photos: photos as unknown as TourTeamOffering["photos"],
        };

        if (isEditing) {
            onSave(offering);
        } else {
            onAdd(offering);
        }
        handleOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{isEditing ? "Edit offer" : "Create an offer"}</DialogTitle>
                    <DialogDescription>
                        {step === 1
                            ? "What can you offer to visiting artists?"
                            : selectedType === "custom"
                              ? "Describe your offer."
                              : `${isEditing ? "Edit" : "Add"} details for ${
                                    selectedType
                                        ? (tourTeamOfferingTypeLabels[selectedType as (typeof tourTeamOfferingTypes)[number]] ?? selectedType)
                                        : ""
                                }.`}
                    </DialogDescription>
                </DialogHeader>

                {step === 1 && !isEditing && (
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
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="offer-checkin-flexible">Flexible check-in</Label>
                                        <Switch
                                            id="offer-checkin-flexible"
                                            checked={checkInFlexible}
                                            onCheckedChange={setCheckInFlexible}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Lets a visiting artist arrive or leave outside your usual check-in/check-out
                                        times, instead of a fixed schedule.
                                    </p>
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
                                    <Label htmlFor="offer-promotion-notes">Anything else about how you&apos;d promote it?</Label>
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

                        {/* Generic freeform note, shown for every type (including Other, where this
                            is the only field) — the base schema's `detail` field, not tied to any
                            one type's `details` variant. */}
                        <div className="space-y-2">
                            <Label htmlFor="offer-detail">Tell people more about this offer</Label>
                            <Textarea
                                id="offer-detail"
                                value={detail}
                                onChange={(e) => setDetail(e.target.value)}
                                maxLength={300}
                                placeholder="Optional"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Photos</Label>
                            <MultiImageUploader
                                initialImages={offeringPhotosToMediaSeed(editingOffering?.photos)}
                                onChange={setPhotos}
                                maxImages={10}
                                previewMode="large"
                            />
                            <p className="text-xs text-muted-foreground">
                                {selectedType === "spare_room" ? ACCOMMODATION_PHOTO_NUDGE : GENERIC_PHOTO_NUDGE}
                            </p>
                        </div>
                    </div>
                )}

                <DialogFooter>
                    {step === 2 && !isEditing && (
                        <Button type="button" variant="outline" onClick={goBack}>
                            Back
                        </Button>
                    )}
                    {step === 2 && (
                        <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
                            {/* "Update", not "Save changes" — this only updates the in-memory
                                offerings list, it doesn't persist anything. Only the page's own
                                Save Changes button calls savePresence. */}
                            {isEditing ? "Update" : "Add offer"}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
