"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { useToast } from "@/components/ui/use-toast";
import { Circle, TourTeamOffering } from "@/models/models";
import { useRouter } from "next/navigation";
import { useForm, Controller, Control } from "react-hook-form";
import { savePresence, setOffersVisibleAction } from "@/app/circles/[handle]/settings/presence/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DynamicTextareaField, DynamicTagsField } from "@/components/forms/dynamic-field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Check, Search, X } from "lucide-react";
import { skillsV2, skillCategoryLabels, SkillCategory } from "@/lib/data/skills-v2";
import { VENUE_OFFER_MODAL_TYPES } from "@/lib/data/tour-team-offerings";
import { OfferManager } from "./offer-manager";
import { isPeerifyVenueIdentity } from "@/lib/peerify/artist-profile";
import { cn } from "@/lib/utils";

interface PresenceSettingsFormProps {
    circle: Circle;
}

const skillNameByHandle = new Map(skillsV2.map((skill) => [skill.handle, skill.name]));
const skillCategoryOrder = Object.keys(skillCategoryLabels) as SkillCategory[];

interface StructuredSkillSelectorProps {
    value: string[] | undefined;
    onChange: (handles: string[]) => void;
}

function StructuredSkillSelector({ value, onChange }: StructuredSkillSelectorProps): React.ReactElement {
    const [searchText, setSearchText] = useState("");

    const selectedHandles = useMemo(() => {
        if (!Array.isArray(value)) return [];

        const dedupedHandles: string[] = [];
        const seen = new Set<string>();

        for (const rawHandle of value) {
            if (typeof rawHandle !== "string") continue;
            const normalizedHandle = rawHandle.trim();
            if (!normalizedHandle || seen.has(normalizedHandle)) continue;
            seen.add(normalizedHandle);
            dedupedHandles.push(normalizedHandle);
        }

        return dedupedHandles;
    }, [value]);

    const filteredSkills = useMemo(() => {
        const query = searchText.trim().toLowerCase();

        if (!query) return skillsV2;

        return skillsV2.filter((skill) => {
            const categoryLabel = skillCategoryLabels[skill.category].toLowerCase();
            return (
                skill.name.toLowerCase().includes(query) ||
                skill.description.toLowerCase().includes(query) ||
                categoryLabel.includes(query)
            );
        });
    }, [searchText]);

    const groupedSkills = useMemo(() => {
        const skillsByCategory = new Map<SkillCategory, typeof skillsV2>();
        for (const category of skillCategoryOrder) {
            skillsByCategory.set(category, []);
        }

        for (const skill of filteredSkills) {
            const currentGroup = skillsByCategory.get(skill.category) || [];
            currentGroup.push(skill);
            skillsByCategory.set(skill.category, currentGroup);
        }

        return skillCategoryOrder
            .map((category) => ({
                category,
                label: skillCategoryLabels[category],
                skills: skillsByCategory.get(category) || [],
            }))
            .filter((group) => group.skills.length > 0);
    }, [filteredSkills]);

    const toggleSkill = (handle: string) => {
        if (selectedHandles.includes(handle)) {
            onChange(selectedHandles.filter((existingHandle) => existingHandle !== handle));
            return;
        }
        onChange([...selectedHandles, handle]);
    };

    return (
        <div className="space-y-3">
            <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                    type="text"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="Search skills..."
                    className="pl-8"
                />
            </div>

            <ScrollArea className="h-[320px] rounded-md border p-3">
                <div className="space-y-4">
                    {groupedSkills.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                            No skills found matching &quot;{searchText}&quot;.
                        </p>
                    )}

                    {groupedSkills.map((group) => (
                        <div key={group.category} className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {group.label}
                            </p>
                            <div className="space-y-1">
                                {group.skills.map((skill) => {
                                    const isSelected = selectedHandles.includes(skill.handle);
                                    return (
                                        <button
                                            key={skill.handle}
                                            type="button"
                                            onClick={() => toggleSkill(skill.handle)}
                                            className={cn(
                                                "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm",
                                                isSelected
                                                    ? "border-primary bg-primary/5 text-foreground"
                                                    : "hover:bg-muted/40",
                                            )}
                                        >
                                            <span>{skill.name}</span>
                                            {isSelected && <Check className="h-4 w-4 text-primary" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </ScrollArea>

            <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Selected skills</p>
                <div className="flex flex-wrap gap-2">
                    {selectedHandles.length > 0 ? (
                        selectedHandles.map((handle) => (
                            <Badge key={handle} variant="secondary" className="flex items-center gap-1">
                                <span>{skillNameByHandle.get(handle) || handle}</span>
                                <button
                                    type="button"
                                    aria-label={`Remove ${skillNameByHandle.get(handle) || handle}`}
                                    onClick={() => toggleSkill(handle)}
                                    className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-black/10"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </Badge>
                        ))
                    ) : (
                        <p className="text-sm text-muted-foreground">No skills selected yet.</p>
                    )}
                </div>
            </div>
        </div>
    );
}

// Auto-saves on click via its own server action (setOffersVisibleAction), mirroring
// CrewEnabledToggle (about-settings-form.tsx) exactly — optimistic flip, revert + toast only on
// failure, no success toast for something this minor, brief "Saved" flash instead. Staying out of
// the shared form means neither direction of accidental interference is possible: clicking this
// never saves/discards unrelated unsaved offerings/needs/engagements edits, and the form's own
// Save Changes button never resets this back to a stale default value.
const OffersVisibleToggle = ({ circleId, initialValue }: { circleId: string; initialValue: boolean }) => {
    const { toast } = useToast();
    const [visible, setVisible] = useState(initialValue);
    const [isSaving, setIsSaving] = useState(false);
    const [justSaved, setJustSaved] = useState(false);

    const onToggle = async (checked: boolean) => {
        setIsSaving(true);
        setJustSaved(false);
        setVisible(checked);
        const res = await setOffersVisibleAction(circleId, checked);
        setIsSaving(false);
        if (!res.success) {
            setVisible(!checked);
            toast({
                title: "Error",
                description: res.message || "Failed to update offers visibility",
                variant: "destructive",
            });
            return;
        }
        setJustSaved(true);
        window.setTimeout(() => setJustSaved(false), 1500);
    };

    return (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <Label htmlFor="offers-visible-toggle">
                <span className="block font-medium">Show my offers on the map</span>
                <span className="mt-1 block text-muted-foreground">
                    {visible
                        ? "Your offers appear as anonymous pins on the public Explore map — no name, photo, or profile link, just the offer type."
                        : "Your offers are hidden from the public Explore map. They're still saved and visible to your own Crew, if any."}
                </span>
            </Label>
            <div className="flex shrink-0 items-center gap-2">
                {justSaved && <span className="text-xs text-muted-foreground">Saved</span>}
                <Switch
                    id="offers-visible-toggle"
                    checked={visible}
                    onCheckedChange={onToggle}
                    disabled={isSaving}
                    className="data-[state=checked]:bg-[hsl(var(--button-primary))]"
                />
            </div>
        </div>
    );
};

export function PresenceSettingsForm({ circle }: PresenceSettingsFormProps): React.ReactElement {
    const { toast } = useToast();
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showOfferingsIntro, setShowOfferingsIntro] = useState(false);
    const isUser = circle.circleType === "user";
    const isVenue = isPeerifyVenueIdentity(circle);
    const useStructuredNeedsSelector = circle.circleType !== "user";
    // Either surface below (individual profile or venue circle) can set tourTeamOfferings and
    // needs the same one-time explainer dialog — copy differs on the anonymity point, since
    // venue offer pins carry identity (see OfferMapPin, models.ts) unlike individual ones.
    const showsOfferingsEditor = isUser || isVenue;

    useEffect(() => {
        if (!showsOfferingsEditor || !circle.handle) return;

        try {
            const storageKey = `peerify_tour_team_offerings_intro_dismissed:${circle.handle}`;
            if (localStorage.getItem(storageKey) !== "true") {
                setShowOfferingsIntro(true);
            }
        } catch {
            // localStorage unavailable (private mode etc.) — skip showing the explainer
        }
    }, [showsOfferingsEditor, circle.handle]);

    const dismissOfferingsIntro = () => {
        setShowOfferingsIntro(false);

        if (!circle.handle) return;
        try {
            localStorage.setItem(`peerify_tour_team_offerings_intro_dismissed:${circle.handle}`, "true");
        } catch {
            // localStorage unavailable — nothing to persist
        }
    };

    const form = useForm({
        defaultValues: {
            _id: circle._id,
            handle: circle.handle,
            offers: circle.offers || {},
            engagements: {
                ...(circle.engagements || {}),
                interests: circle.interests?.length ? circle.interests : circle.engagements?.interests || [],
            },
            needs: circle.needs || {},
            tourTeamOfferings: circle.tourTeamOfferings || [],
        },
    });

    const onSubmit = async (data: any) => {
        setIsSubmitting(true);
        try {
            const tourTeamOfferings = Array.isArray(data.tourTeamOfferings)
                ? data.tourTeamOfferings.filter(
                      (offering: TourTeamOffering) =>
                          offering.type !== "custom" || (offering.label || "").trim().length > 0,
                  )
                : data.tourTeamOfferings;

            const result = await savePresence({ ...data, tourTeamOfferings });
            if (result.success) {
                // savePresence returns the server-resolved offerings (real FileInfo photos, not
                // the pre-save ImageItem drafts) — re-sync the form to them so editing the same
                // offering again later in this page session seeds its photo picker from
                // resolvable URLs instead of stale draft objects. router.refresh() alone doesn't
                // do this: it re-renders the server tree, but this form's defaultValues were only
                // ever applied once, at initial mount. Uses form.reset() rather than
                // form.setValue() — reset() unconditionally replaces the whole form's values and
                // forces every subscribed Controller to re-render, with no dependency on a field
                // having already been "seen" by RHF's internal registry the way setValue's
                // notification path does; also clears isDirty now that the save succeeded.
                form.reset({
                    ...data,
                    tourTeamOfferings: Array.isArray(result.data?.tourTeamOfferings)
                        ? result.data.tourTeamOfferings
                        : tourTeamOfferings,
                });
                toast({
                    title: "Success",
                    description: isUser ? "Offers updated successfully" : "Offers and needs updated successfully",
                });
                router.refresh();
            } else {
                toast({
                    title: "Error",
                    description: result.message || "Failed to update settings",
                    variant: "destructive",
                });
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "An unexpected error occurred",
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            {showsOfferingsEditor && (
                <Dialog
                    open={showOfferingsIntro}
                    onOpenChange={(open) => (open ? setShowOfferingsIntro(true) : dismissOfferingsIntro())}
                >
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Before you add your Offers</DialogTitle>
                            <DialogDescription className="space-y-3">
                                <p>
                                    You&apos;re not committing to provide anything — this is a potential offer, not a
                                    promise.
                                </p>
                                <p>You choose who to share your offer details with.</p>
                                {isVenue ? (
                                    <p>
                                        Choose whether to show your offers as pins on the public Explore map — off by
                                        default. Unlike individual profiles, venue offer pins show your venue&apos;s
                                        name so artists can act on them.
                                    </p>
                                ) : (
                                    <p>
                                        Choose whether to show your offers as anonymous pins on the public Explore map
                                        — off by default, and nothing identifying is ever shown even when it&apos;s
                                        on.
                                    </p>
                                )}
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button type="button" onClick={dismissOfferingsIntro}>
                                OK, I understand.
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="formatted space-y-6">
                    {!isUser && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Opportunities</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Controller
                                    name="offers.text"
                                    control={form.control as unknown as Control}
                                    render={({ field }) => (
                                        <DynamicTextareaField
                                            field={{
                                                name: "offers.text",
                                                type: "textarea",
                                                label: "Why get involved",
                                                maxLength: 600,
                                            }}
                                            formField={field}
                                            control={form.control as unknown as Control}
                                        />
                                    )}
                                />
                            </CardContent>
                        </Card>
                    )}

                    {isUser && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Offers</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <p className="text-xs font-medium text-muted-foreground">
                                    You decide what to share and with whom. Nothing is shared without your choice.
                                </p>
                                {/* Auto-saves on click via its own action (setOffersVisibleAction) — kept
                                    entirely out of this form's state/submit, same reasoning as
                                    CrewEnabledToggle (about-settings-form.tsx): clicking it must never
                                    save/discard unrelated unsaved edits below, and the form's own Save
                                    Changes button must never reset it back to a stale default value. */}
                                <OffersVisibleToggle
                                    circleId={circle._id ?? ""}
                                    initialValue={circle.offersVisible === true}
                                />
                                <Controller
                                    name="tourTeamOfferings"
                                    control={form.control as unknown as Control}
                                    render={({ field }) => (
                                        <OfferManager
                                            value={field.value as TourTeamOffering[] | undefined}
                                            onChange={field.onChange}
                                        />
                                    )}
                                />
                            </CardContent>
                        </Card>
                    )}

                    {isVenue && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Offers</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <p className="text-xs font-medium text-muted-foreground">
                                    You decide what to share and with whom. Unlike an individual profile, a venue
                                    offer pin shows your venue&apos;s name — an anonymous pin isn&apos;t actionable
                                    for booking.
                                </p>
                                {/* Same auto-save-on-click pattern as the isUser Offers card above — see that
                                    card's comment for why this stays out of the form's state/submit. */}
                                <OffersVisibleToggle
                                    circleId={circle._id ?? ""}
                                    initialValue={circle.offersVisible === true}
                                />
                                <Controller
                                    name="tourTeamOfferings"
                                    control={form.control as unknown as Control}
                                    render={({ field }) => (
                                        <OfferManager
                                            value={field.value as TourTeamOffering[] | undefined}
                                            onChange={field.onChange}
                                            allowedTypes={VENUE_OFFER_MODAL_TYPES}
                                        />
                                    )}
                                />
                            </CardContent>
                        </Card>
                    )}

                    {!isUser && (
                        <Card>
                            <CardHeader>
                                <CardTitle>What we need help with</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Controller
                                    name="needs.text"
                                    control={form.control as unknown as Control}
                                    render={({ field }) => (
                                        <DynamicTextareaField
                                            field={{
                                                name: "needs.text",
                                                type: "textarea",
                                                label: "Current needs",
                                                maxLength: 600,
                                            }}
                                            formField={field}
                                            control={form.control as unknown as Control}
                                        />
                                    )}
                                />
                                <Controller
                                    name="needs.tags"
                                    control={form.control as unknown as Control}
                                    render={({ field }) =>
                                        useStructuredNeedsSelector ? (
                                            <div className="space-y-2">
                                                <p className="text-sm font-medium">Needs</p>
                                                <StructuredSkillSelector
                                                    value={field.value as string[] | undefined}
                                                    onChange={field.onChange}
                                                />
                                            </div>
                                        ) : (
                                            <DynamicTagsField
                                                field={{
                                                    name: "needs.tags",
                                                    type: "tags",
                                                    label: "Needs",
                                                }}
                                                formField={field}
                                                control={form.control as unknown as Control}
                                            />
                                        )
                                    }
                                />
                            </CardContent>
                        </Card>
                    )}

                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Saving..." : "Save Changes"}
                    </Button>
                </form>
            </Form>
        </>
    );
}
