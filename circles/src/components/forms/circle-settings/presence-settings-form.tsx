"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { useToast } from "@/components/ui/use-toast";
import { Circle, tourTeamOfferingTypes, TourTeamOffering } from "@/models/models";
import { useRouter } from "next/navigation";
import { useForm, Controller, Control } from "react-hook-form";
import { savePresence } from "@/app/circles/[handle]/settings/presence/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DynamicTextareaField, DynamicTagsField } from "@/components/forms/dynamic-field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Check, Search, X } from "lucide-react";
import { skillsV2, skillCategoryLabels, SkillCategory } from "@/lib/data/skills-v2";
import { tourTeamOfferingTypeLabels } from "@/lib/data/tour-team-offerings";
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

interface TourTeamOfferingsEditorProps {
    value: TourTeamOffering[] | undefined;
    onChange: (offerings: TourTeamOffering[]) => void;
}

function TourTeamOfferingsEditor({ value, onChange }: TourTeamOfferingsEditorProps): React.ReactElement {
    const offerings = useMemo(() => (Array.isArray(value) ? value : []), [value]);

    const predefinedByType = useMemo(() => {
        const map = new Map<string, TourTeamOffering>();
        for (const offering of offerings) {
            if (offering.type !== "custom") {
                map.set(offering.type, offering);
            }
        }
        return map;
    }, [offerings]);

    const customOfferings = useMemo(() => offerings.filter((offering) => offering.type === "custom"), [offerings]);

    const togglePredefined = (type: (typeof tourTeamOfferingTypes)[number]) => {
        if (predefinedByType.has(type)) {
            onChange(offerings.filter((offering) => offering.type !== type));
            return;
        }
        onChange([...offerings, { id: type, type, detail: "" }]);
    };

    const updatePredefinedDetail = (type: (typeof tourTeamOfferingTypes)[number], detail: string) => {
        onChange(offerings.map((offering) => (offering.type === type ? { ...offering, detail } : offering)));
    };

    const addCustomOffering = () => {
        onChange([...offerings, { id: crypto.randomUUID(), type: "custom", label: "", detail: "" }]);
    };

    const updateCustomOffering = (id: string, patch: Partial<TourTeamOffering>) => {
        onChange(offerings.map((offering) => (offering.id === id ? { ...offering, ...patch } : offering)));
    };

    const removeOffering = (id: string) => {
        onChange(offerings.filter((offering) => offering.id !== id));
    };

    return (
        <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
                {tourTeamOfferingTypes.map((type) => {
                    const selected = predefinedByType.get(type);
                    const isSelected = Boolean(selected);
                    return (
                        <div
                            key={type}
                            className={cn(
                                "space-y-2 rounded-md border px-3 py-2",
                                isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                            )}
                        >
                            <button
                                type="button"
                                onClick={() => togglePredefined(type)}
                                className="flex w-full items-center justify-between text-left text-sm"
                            >
                                <span>{tourTeamOfferingTypeLabels[type]}</span>
                                {isSelected && <Check className="h-4 w-4 text-primary" />}
                            </button>
                            {isSelected && (
                                <Input
                                    type="text"
                                    value={selected?.detail || ""}
                                    onChange={(event) => updatePredefinedDetail(type, event.target.value)}
                                    placeholder="Anything else? (optional)"
                                    maxLength={300}
                                />
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="space-y-3">
                <p className="text-sm font-medium">Custom offerings</p>
                {customOfferings.map((offering) => (
                    <div key={offering.id} className="space-y-2 rounded-md border px-3 py-2">
                        <div className="flex items-center gap-2">
                            <Input
                                type="text"
                                value={offering.label || ""}
                                onChange={(event) => updateCustomOffering(offering.id, { label: event.target.value })}
                                placeholder="e.g. Instrument loan"
                                maxLength={60}
                            />
                            <button
                                type="button"
                                aria-label="Remove offering"
                                onClick={() => removeOffering(offering.id)}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/10"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <Input
                            type="text"
                            value={offering.detail || ""}
                            onChange={(event) => updateCustomOffering(offering.id, { detail: event.target.value })}
                            placeholder="Anything else? (optional)"
                            maxLength={300}
                        />
                    </div>
                ))}

                <Button type="button" variant="outline" onClick={addCustomOffering}>
                    + Add an offering
                </Button>
            </div>
        </div>
    );
}

export function PresenceSettingsForm({ circle }: PresenceSettingsFormProps): React.ReactElement {
    const { toast } = useToast();
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isUser = circle.circleType === "user";
    const useStructuredNeedsSelector = circle.circleType !== "user";

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
                toast({
                    title: "Success",
                    description: isUser
                        ? "Tour-team offerings updated successfully"
                        : "Offers and needs updated successfully",
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
                            <CardTitle>Tour-Team Offerings</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Let touring artists know what you can offer when they come through your city.
                            </p>
                            <Controller
                                name="tourTeamOfferings"
                                control={form.control as unknown as Control}
                                render={({ field }) => (
                                    <TourTeamOfferingsEditor
                                        value={field.value as TourTeamOffering[] | undefined}
                                        onChange={field.onChange}
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
                                render={({ field }) => (
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
                                )}
                            />
                        </CardContent>
                    </Card>
                )}

                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : "Save Changes"}
                </Button>
            </form>
        </Form>
    );
}
