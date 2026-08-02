"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { PRIMARY_GENRE_MAX_SELECTIONS, PRIMARY_GENRE_OPTIONS } from "@/lib/peerify/artist-profile";
import { savePrimaryGenresAction } from "@/app/onboarding/pilot/actions";

// Shared between Frame F2 (fan) and Frame A5 (artist) — same taxonomy
// (PRIMARY_GENRE_OPTIONS) the artist Settings/About genre picker already uses. Fans aren't
// capped here (see maxSelections below, passed as Infinity from the fan-genres step) — the
// artist side keeps the existing PRIMARY_GENRE_MAX_SELECTIONS default unchanged.
type GenresStepProps = {
    circleId: string;
    initialGenres?: string[];
    initialGenreOther?: string;
    maxSelections?: number;
    onContinue: () => void;
    onSkip: () => void;
};

export function GenresStep({
    circleId,
    initialGenres,
    initialGenreOther,
    maxSelections = PRIMARY_GENRE_MAX_SELECTIONS,
    onContinue,
    onSkip,
}: GenresStepProps) {
    const { toast } = useToast();
    const [selected, setSelected] = useState<string[]>(initialGenres || []);
    const [otherText, setOtherText] = useState(initialGenreOther || "");
    const [isSaving, setIsSaving] = useState(false);

    const toggleGenre = (genre: string) => {
        setSelected((prev) => {
            if (prev.includes(genre)) return prev.filter((g) => g !== genre);
            if (prev.length >= maxSelections) return prev;
            return [...prev, genre];
        });
    };

    const handleContinue = async () => {
        if (selected.length === 0) {
            onContinue();
            return;
        }

        setIsSaving(true);
        try {
            const result = await savePrimaryGenresAction(circleId, selected, otherText);
            if (!result.success) {
                toast({ title: "Couldn't save genres", description: result.message, variant: "destructive" });
                return;
            }
            onContinue();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
                {PRIMARY_GENRE_OPTIONS.map((genre) => {
                    const isSelected = selected.includes(genre);
                    return (
                        <button
                            key={genre}
                            type="button"
                            onClick={() => toggleGenre(genre)}
                            className={cn(
                                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                                isSelected
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "bg-background hover:border-primary/60",
                            )}
                        >
                            {genre}
                        </button>
                    );
                })}
            </div>

            <Badge variant="secondary" className="text-sm">
                {Number.isFinite(maxSelections) ? `${selected.length}/${maxSelections} selected` : `${selected.length} selected`}
            </Badge>

            {selected.includes("Other") ? (
                <div className="space-y-2">
                    <Label htmlFor="onboarding-genre-other">Tell us more</Label>
                    <Input
                        id="onboarding-genre-other"
                        value={otherText}
                        onChange={(event) => setOtherText(event.target.value)}
                        placeholder="Your genre"
                    />
                </div>
            ) : null}

            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                <Button type="button" variant="outline" className="sm:flex-1" onClick={onSkip} disabled={isSaving}>
                    Skip for now
                </Button>
                <Button type="button" className="sm:flex-1" onClick={handleContinue} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Continue
                </Button>
            </div>
        </div>
    );
}
