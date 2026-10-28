"use client";

// Add or edit one pop-up or private space (see lib/data/space.ts). The server validates again with
// parseSpaceInput; checks here are only for quick feedback. For a private space that isn't on the
// map, the picked location is rounded to its area the moment it's picked (toAreaOnlyLocation), so
// the exact point stays in the browser: the map pin jumps to the rounded point to show what will be
// stored. A private space on the map (publiclyListed) sends the picked point instead; the server
// moves it 200–400 m and stores only the moved point.

import React, { useCallback, useState, useTransition } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import LocationPicker from "@/components/forms/location-picker";
import {
    Location,
    SPACE_AMPLIFICATION_OPTIONS,
    SPACE_DEAL_PREFERENCES,
    SPACE_NAME_MAX_LENGTH,
    SPACE_NOTES_MAX_LENGTH,
    SPACE_SHORT_TEXT_MAX_LENGTH,
    SPACE_TEXT_MAX_LENGTH,
    SpaceDealPreference,
    SpaceType,
} from "@/models/models";
import { EVENT_TAG_ACCESSIBILITY_OPTIONS, EVENT_TAG_SETTING_OPTIONS } from "@/lib/peerify/event-tags";
import type { EventTagAccessibility, EventTagSetting } from "@/lib/peerify/event-tags";
import { PRIVATE_SPACE_PRECISION, toAreaOnlyLocation } from "@/lib/spaces/space-rules";
import { OFFER_PIN_OFFSET_MAX_METERS, OFFER_PIN_OFFSET_MIN_METERS } from "@/lib/utils";
import {
    HOST_RESPONSIBILITY_TEXT,
    LISTENING_RULE_TEXT,
    SPACE_AMPLIFICATION_LABELS,
    SPACE_DEAL_PREFERENCE_LABELS,
    SPACE_TYPE_LABELS,
    spaceSettingLabel,
    spaceStepFreeAccessLabel,
} from "@/lib/spaces/space-labels";
import type { SpaceView } from "@/lib/data/space";
import { createSpaceAction, updateSpaceAction } from "@/app/circles/[handle]/settings/spaces/actions";

const PIN_RANGE = `${OFFER_PIN_OFFSET_MIN_METERS}–${OFFER_PIN_OFFSET_MAX_METERS} m`;

type FormState = {
    name: string;
    location?: Location;
    capacity: string;
    dealPreferences: SpaceDealPreference[];
    showTimes: string;
    noiseLimits: string;
    powerAvailable: boolean;
    paAvailable: boolean;
    setting: EventTagSetting[];
    amplification: "acoustic_only" | "amplified_ok" | "";
    noiseCurfew: string;
    stepFreeAccess: EventTagAccessibility | "";
    notesForPeerify: string;
    publiclyListed: boolean;
    listeningRuleAccepted: boolean;
    hostResponsibilityAccepted: boolean;
};

const fromSpace = (space: SpaceView | undefined): FormState => {
    const s = (space ?? {}) as Partial<Record<string, any>>;
    return {
        name: s.name ?? "",
        location: s.location,
        capacity: s.capacity ? String(s.capacity) : "",
        dealPreferences: s.dealPreferences ?? [],
        showTimes: s.showTimes ?? "",
        noiseLimits: s.noiseLimits ?? "",
        powerAvailable: s.powerAvailable === true,
        paAvailable: s.paAvailable === true,
        setting: s.setting ?? [],
        amplification: s.amplification ?? "",
        noiseCurfew: s.noiseCurfew ?? "",
        stepFreeAccess: s.stepFreeAccess ?? "",
        notesForPeerify: s.notesForPeerify ?? "",
        publiclyListed: s.publiclyListed === true,
        // An existing space was saved with both ticked.
        listeningRuleAccepted: !!space,
        hostResponsibilityAccepted: !!space,
    };
};

// The fields of one type only, so a private space never sends a name or pop-up fields.
const toInput = (type: SpaceType, form: FormState) => {
    const common = {
        type,
        location: form.location,
        capacity: Number(form.capacity),
        dealPreferences: form.dealPreferences,
        listeningRuleAccepted: form.listeningRuleAccepted,
        hostResponsibilityAccepted: form.hostResponsibilityAccepted,
    };
    if (type === "popup") {
        return {
            ...common,
            name: form.name,
            showTimes: form.showTimes,
            noiseLimits: form.noiseLimits,
            powerAvailable: form.powerAvailable,
            paAvailable: form.paAvailable,
        };
    }
    return {
        ...common,
        setting: form.setting,
        amplification: form.amplification,
        noiseCurfew: form.noiseCurfew,
        stepFreeAccess: form.stepFreeAccess,
        notesForPeerify: form.notesForPeerify,
        publiclyListed: form.publiclyListed,
    };
};

const quickCheck = (type: SpaceType, form: FormState): string | null => {
    if (type === "popup" && !form.name.trim()) return "Give the space a name.";
    if (!form.location?.lngLat) {
        if (type === "popup") return "Pick the place on the map.";
        return form.publiclyListed ? "Pick your place on the map." : "Pick your area on the map.";
    }
    const capacity = Number(form.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) return "Enter how many people fit, as a whole number.";
    if (type === "popup" && !form.showTimes.trim()) return "Say when shows are possible.";
    if (type === "private" && form.setting.length === 0) return "Choose indoor, outdoor or both.";
    if (type === "private" && !form.amplification) return "Choose acoustic only or amplified.";
    if (type === "private" && !form.stepFreeAccess) return "Choose an option for step-free access.";
    if (form.dealPreferences.length === 0) return "Choose at least one deal preference.";
    if (!form.listeningRuleAccepted || !form.hostResponsibilityAccepted) return "Tick both boxes at the end.";
    return null;
};

interface SpaceFormDialogProps {
    type: SpaceType;
    // Set when editing.
    space?: SpaceView;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: (spaces: SpaceView[]) => void;
}

export function SpaceFormDialog({ type, space, isOpen, onOpenChange, onSaved }: SpaceFormDialogProps) {
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [form, setForm] = useState<FormState>(() => fromSpace(space));
    const [error, setError] = useState<string | null>(null);
    const idPrefix = React.useId();
    const isPrivate = type === "private";
    // Saved with a pin already: the form sends its stored point back, and the server keeps it.
    const hasPlacedPin = !!(space && space.type === "private" && space.mapPinPlacedAt);
    const isListed = isPrivate && form.publiclyListed;

    const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setError(null);
        setForm((current) => ({ ...current, [key]: value }));
    };

    // Stable, so LocationPicker's precision effect doesn't fire on every render.
    const handleLocationChange = useCallback(
        (location: Location | undefined) => {
            setError(null);
            setForm((current) => ({
                ...current,
                location: isPrivate && !current.publiclyListed ? toAreaOnlyLocation(location) : location,
            }));
        },
        [isPrivate],
    );

    // Turning the map on asks for the place itself, unless this space already has its pin: a
    // rounded area can't become a pin. Turning it off rounds whatever was picked.
    const setListed = (on: boolean) => {
        setError(null);
        setForm((current) => {
            if (!on) return { ...current, publiclyListed: false, location: toAreaOnlyLocation(current.location) };
            const stored = space?.location?.lngLat;
            const picked = current.location?.lngLat;
            const keep = hasPlacedPin && !!stored && !!picked && stored.lng === picked.lng && stored.lat === picked.lat;
            return { ...current, publiclyListed: true, location: keep ? current.location : undefined };
        });
    };

    const toggleDeal = (deal: SpaceDealPreference, on: boolean) => {
        setError(null);
        setForm((current) => {
            if (!on) return { ...current, dealPreferences: current.dealPreferences.filter((d) => d !== deal) };
            // "none" stands alone: picking it clears the others, picking another clears it.
            const next = deal === "none" ? ["none"] : [...current.dealPreferences.filter((d) => d !== "none"), deal];
            return { ...current, dealPreferences: next as SpaceDealPreference[] };
        });
    };

    const toggleSetting = (setting: EventTagSetting, on: boolean) => {
        setError(null);
        setForm((current) => ({
            ...current,
            setting: on ? [...current.setting.filter((s) => s !== setting), setting] : current.setting.filter((s) => s !== setting),
        }));
    };

    const close = (open: boolean) => {
        if (!open) {
            setForm(fromSpace(space));
            setError(null);
        }
        onOpenChange(open);
    };

    const handleSubmit = () => {
        const problem = quickCheck(type, form);
        if (problem) {
            setError(problem);
            return;
        }
        startTransition(async () => {
            const input = toInput(type, form);
            const result = space ? await updateSpaceAction(space._id, input) : await createSpaceAction(input);
            if (!result.success) {
                setError(result.message);
                return;
            }
            toast({ title: space ? "Space updated" : "Space added" });
            onSaved(result.spaces);
            close(false);
        });
    };

    const id = (name: string) => `${idPrefix}-${name}`;

    return (
        <Dialog open={isOpen} onOpenChange={close}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]">
                <DialogHeader>
                    <DialogTitle>
                        {space ? "Edit" : "Add a"} {SPACE_TYPE_LABELS[type].toLowerCase()}
                    </DialogTitle>
                    <DialogDescription>
                        {isListed
                            ? `Shown on the map as a pin ${PIN_RANGE} from your place. We never store or show your address.`
                            : isPrivate
                              ? "Only you and the Peerify team can see this. We store the rough area only, never your address."
                              : "Only you and the Peerify team can see this for now."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    {!isPrivate ? (
                        <div className="space-y-2">
                            <Label htmlFor={id("name")}>Name of the space</Label>
                            <Input
                                id={id("name")}
                                value={form.name}
                                maxLength={SPACE_NAME_MAX_LENGTH}
                                onChange={(event) => update("name", event.target.value)}
                                placeholder="Kafé Lyssna"
                            />
                        </div>
                    ) : null}

                    {isPrivate ? (
                        <div className="flex items-start justify-between gap-4 rounded-md border p-4">
                            <div className="space-y-1">
                                <Label htmlFor={id("listed")}>Show this space on the Peerify map</Label>
                                <p className="text-sm text-muted-foreground">
                                    People see a pin with the kind of space and your area&apos;s name, never your
                                    name, profile or address. The pin sits {PIN_RANGE} from the place you pick, in a
                                    direction we choose at random.
                                </p>
                            </div>
                            <Switch id={id("listed")} checked={form.publiclyListed} onCheckedChange={setListed} />
                        </div>
                    ) : null}

                    <div className="space-y-2">
                        <Label>{isListed ? "Your place" : isPrivate ? "Your area" : "Where it is"}</Label>
                        <p className="text-sm text-muted-foreground">
                            {isListed
                                ? `Search for your address or tap the map at your place. Before saving, we move the point ${PIN_RANGE} in a random direction and keep only the moved point, never the one you picked.`
                                : isPrivate
                                  ? "Search for your town or tap the map near you. We round it to an area of about 10 km, and that's all we keep: the pin moves to the rounded point."
                                  : "Search for the address or tap the map."}
                        </p>
                        <LocationPicker
                            value={
                                isListed
                                    ? (form.location ?? { precision: 4 })
                                    : isPrivate
                                      ? (form.location ?? { precision: PRIVATE_SPACE_PRECISION })
                                      : form.location
                            }
                            onChange={handleLocationChange}
                            compact={true}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor={id("capacity")}>How many people fit</Label>
                        <Input
                            id={id("capacity")}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            step={1}
                            className="max-w-[160px]"
                            value={form.capacity}
                            onChange={(event) => update("capacity", event.target.value)}
                        />
                    </div>

                    {!isPrivate ? (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor={id("showTimes")}>When shows are possible</Label>
                                <Textarea
                                    id={id("showTimes")}
                                    rows={2}
                                    maxLength={SPACE_TEXT_MAX_LENGTH}
                                    value={form.showTimes}
                                    onChange={(event) => update("showTimes", event.target.value)}
                                    placeholder="Sunday evenings after closing, some weekday nights"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor={id("noiseLimits")}>Noise limits (optional)</Label>
                                <Textarea
                                    id={id("noiseLimits")}
                                    rows={2}
                                    maxLength={SPACE_TEXT_MAX_LENGTH}
                                    value={form.noiseLimits}
                                    onChange={(event) => update("noiseLimits", event.target.value)}
                                    placeholder="Quiet after 22:00, neighbours upstairs"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Equipment</Label>
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id={id("power")}
                                        checked={form.powerAvailable}
                                        onCheckedChange={(checked) => update("powerAvailable", checked === true)}
                                    />
                                    <Label htmlFor={id("power")} className="font-normal">
                                        Power sockets near where the artist plays
                                    </Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id={id("pa")}
                                        checked={form.paAvailable}
                                        onCheckedChange={(checked) => update("paAvailable", checked === true)}
                                    />
                                    <Label htmlFor={id("pa")} className="font-normal">
                                        A PA or speakers artists can use
                                    </Label>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <Label>Indoor or outdoor</Label>
                                {EVENT_TAG_SETTING_OPTIONS.map((setting) => (
                                    <div key={setting} className="flex items-center gap-2">
                                        <Checkbox
                                            id={id(`setting-${setting}`)}
                                            checked={form.setting.includes(setting)}
                                            onCheckedChange={(checked) => toggleSetting(setting, checked === true)}
                                        />
                                        <Label htmlFor={id(`setting-${setting}`)} className="font-normal">
                                            {spaceSettingLabel(setting)}
                                        </Label>
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-2">
                                <Label>Sound</Label>
                                <RadioGroup
                                    value={form.amplification}
                                    onValueChange={(value) => update("amplification", value as FormState["amplification"])}
                                >
                                    {SPACE_AMPLIFICATION_OPTIONS.map((option) => (
                                        <div key={option} className="flex items-center gap-2">
                                            <RadioGroupItem value={option} id={id(`amp-${option}`)} />
                                            <Label htmlFor={id(`amp-${option}`)} className="font-normal">
                                                {SPACE_AMPLIFICATION_LABELS[option]}
                                            </Label>
                                        </div>
                                    ))}
                                </RadioGroup>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor={id("curfew")}>Noise curfew (optional)</Label>
                                <Input
                                    id={id("curfew")}
                                    className="max-w-[240px]"
                                    maxLength={SPACE_SHORT_TEXT_MAX_LENGTH}
                                    value={form.noiseCurfew}
                                    onChange={(event) => update("noiseCurfew", event.target.value)}
                                    placeholder="22:00"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Step-free access</Label>
                                <RadioGroup
                                    value={form.stepFreeAccess}
                                    onValueChange={(value) => update("stepFreeAccess", value as EventTagAccessibility)}
                                >
                                    {EVENT_TAG_ACCESSIBILITY_OPTIONS.map((option) => (
                                        <div key={option} className="flex items-center gap-2">
                                            <RadioGroupItem value={option} id={id(`access-${option}`)} />
                                            <Label htmlFor={id(`access-${option}`)} className="font-normal">
                                                {spaceStepFreeAccessLabel(option)}
                                            </Label>
                                        </div>
                                    ))}
                                </RadioGroup>
                            </div>
                        </>
                    )}

                    <div className="space-y-2">
                        <Label>What would you like in return?</Label>
                        <p className="text-sm text-muted-foreground">Choose any that suit you.</p>
                        {SPACE_DEAL_PREFERENCES.map((deal) => (
                            <div key={deal} className="flex items-center gap-2">
                                <Checkbox
                                    id={id(`deal-${deal}`)}
                                    checked={form.dealPreferences.includes(deal)}
                                    onCheckedChange={(checked) => toggleDeal(deal, checked === true)}
                                />
                                <Label htmlFor={id(`deal-${deal}`)} className="font-normal">
                                    {SPACE_DEAL_PREFERENCE_LABELS[deal]}
                                </Label>
                            </div>
                        ))}
                    </div>

                    {isPrivate ? (
                        <div className="space-y-2">
                            <Label htmlFor={id("notes")}>Notes for Peerify (optional)</Label>
                            <p className="text-sm text-muted-foreground">
                                Only the Peerify team reads this. Please don&apos;t include your address.
                            </p>
                            <Textarea
                                id={id("notes")}
                                rows={3}
                                maxLength={SPACE_NOTES_MAX_LENGTH}
                                value={form.notesForPeerify}
                                onChange={(event) => update("notesForPeerify", event.target.value)}
                            />
                        </div>
                    ) : null}

                    <div className="space-y-3 rounded-md border p-4">
                        <div className="flex items-start gap-2">
                            <Checkbox
                                id={id("listening")}
                                className="mt-0.5"
                                checked={form.listeningRuleAccepted}
                                onCheckedChange={(checked) => update("listeningRuleAccepted", checked === true)}
                            />
                            <Label htmlFor={id("listening")} className="font-normal leading-snug">
                                {LISTENING_RULE_TEXT}
                            </Label>
                        </div>
                        <div className="flex items-start gap-2">
                            <Checkbox
                                id={id("responsibility")}
                                className="mt-0.5"
                                checked={form.hostResponsibilityAccepted}
                                onCheckedChange={(checked) => update("hostResponsibilityAccepted", checked === true)}
                            />
                            <Label htmlFor={id("responsibility")} className="font-normal leading-snug">
                                {HOST_RESPONSIBILITY_TEXT}
                            </Label>
                        </div>
                    </div>

                    {error ? <p className="text-sm text-red-500">{error}</p> : null}

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => close(false)} disabled={isPending}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={handleSubmit} disabled={isPending}>
                            {isPending ? "Saving..." : space ? "Save changes" : "Add space"}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default SpaceFormDialog;
