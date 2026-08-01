"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { Circle, TourTeamOffering, tourTeamOfferingTypes } from "@/models/models";
import { tourTeamOfferingTypeLabels } from "@/lib/data/tour-team-offerings";
import { savePresence } from "@/app/circles/[handle]/settings/presence/actions";

type OffersStepProps = {
    circleId: string;
    circleHandle: string;
    initialOfferings?: TourTeamOffering[];
    onContinue: () => void;
};

// Frame F3-expanded. Reuses the existing tourTeamOfferings field/shape and the existing
// savePresence() action (src/app/circles/[handle]/settings/presence/actions.ts) rather than a
// new parallel field — this is the same data the Presence Settings page already edits.
export function OffersStep({ circleId, circleHandle, initialOfferings, onContinue }: OffersStepProps) {
    const { toast } = useToast();
    const [offerings, setOfferings] = useState<TourTeamOffering[]>(initialOfferings || []);
    const [isSaving, setIsSaving] = useState(false);

    const toggleStandardOffering = (type: (typeof tourTeamOfferingTypes)[number]) => {
        setOfferings((prev) => {
            const exists = prev.some((offering) => offering.id === type);
            if (exists) return prev.filter((offering) => offering.id !== type);
            return [...prev, { id: type, type, detail: "" }];
        });
    };

    const addCustomOffering = () => {
        setOfferings((prev) => [...prev, { id: crypto.randomUUID(), type: "custom", label: "", detail: "" }]);
    };

    const updateOffering = (id: string, patch: Partial<TourTeamOffering>) => {
        setOfferings((prev) => prev.map((offering) => (offering.id === id ? { ...offering, ...patch } : offering)));
    };

    const removeOffering = (id: string) => {
        setOfferings((prev) => prev.filter((offering) => offering.id !== id));
    };

    const hasIncompleteCustomOffering = offerings.some(
        (offering) => offering.type === "custom" && !offering.label?.trim(),
    );

    const handleContinue = async () => {
        if (offerings.length === 0) {
            onContinue();
            return;
        }

        if (hasIncompleteCustomOffering) return;

        setIsSaving(true);
        try {
            const result = await savePresence({
                _id: circleId,
                handle: circleHandle,
                tourTeamOfferings: offerings,
            } as Circle);
            if (!result.success) {
                toast({ title: "Couldn't save your offers", description: result.message, variant: "destructive" });
                return;
            }
            onContinue();
        } finally {
            setIsSaving(false);
        }
    };

    const customOfferings = offerings.filter((offering) => offering.type === "custom");

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
                {tourTeamOfferingTypes.map((type) => {
                    const isSelected = offerings.some((offering) => offering.id === type);
                    return (
                        <button
                            key={type}
                            type="button"
                            onClick={() => toggleStandardOffering(type)}
                            className={cn(
                                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                                isSelected
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "bg-background hover:border-primary/60",
                            )}
                        >
                            {tourTeamOfferingTypeLabels[type]}
                        </button>
                    );
                })}
                <button
                    type="button"
                    onClick={addCustomOffering}
                    className="rounded-full border border-dashed px-3 py-1.5 text-sm font-medium hover:border-primary/60"
                >
                    + Something else
                </button>
            </div>

            {offerings.length > 0 ? (
                <div className="space-y-3">
                    {offerings.map((offering) => (
                        <div key={offering.id} className="space-y-2 rounded-lg border p-3">
                            <div className="flex items-center justify-between gap-2">
                                {offering.type === "custom" ? (
                                    <Input
                                        value={offering.label || ""}
                                        onChange={(event) => updateOffering(offering.id, { label: event.target.value })}
                                        onKeyDown={(event) => {
                                            // Single-line field — belt-and-suspenders against Enter ever being
                                            // read as "submit" (no <form> wraps this today, but nothing here
                                            // should advance the step except the explicit Continue click).
                                            if (event.key === "Enter") event.preventDefault();
                                        }}
                                        placeholder="What can you offer?"
                                        maxLength={60}
                                    />
                                ) : (
                                    <span className="text-sm font-medium">{tourTeamOfferingTypeLabels[offering.type as (typeof tourTeamOfferingTypes)[number]]}</span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => removeOffering(offering.id)}
                                    className="text-muted-foreground hover:text-foreground"
                                    aria-label="Remove"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <Textarea
                                value={offering.detail || ""}
                                onChange={(event) => updateOffering(offering.id, { detail: event.target.value })}
                                onKeyDown={(event) => {
                                    // Multi-line field — Enter should only ever insert a newline here.
                                    // Nothing advances the step except the explicit Continue click below;
                                    // this just stops the keystroke from bubbling to any ancestor handler.
                                    if (event.key === "Enter") event.stopPropagation();
                                }}
                                placeholder="Add detail (optional)"
                                maxLength={300}
                                className="min-h-[60px]"
                            />
                        </div>
                    ))}
                </div>
            ) : null}

            <Button type="button" className="w-full" onClick={handleContinue} disabled={isSaving || hasIncompleteCustomOffering}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Continue
            </Button>
            {customOfferings.some((offering) => !offering.label?.trim()) ? (
                <p className="text-xs text-muted-foreground">Give your custom offering a name before continuing.</p>
            ) : null}
        </div>
    );
}
