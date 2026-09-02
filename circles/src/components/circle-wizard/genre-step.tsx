"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckboxGroup } from "@/components/forms/genre-checkbox-group";
import { CircleWizardStepProps } from "./circle-wizard";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { saveGenresAction } from "./actions";
import { PRIMARY_GENRE_OPTIONS, PRIMARY_GENRE_MAX_SELECTIONS } from "@/lib/peerify/artist-profile";

export default function GenreStep({ circleData, setCircleData, nextStep, prevStep }: CircleWizardStepProps) {
    const [isPending, startTransition] = useTransition();
    const genres = circleData.primaryGenres || [];
    const entityLabel = circleData.circleType === "project" ? "Project" : "Circle";
    const entityLabelLower = entityLabel.toLowerCase();

    const save = (onSaved: () => void) => {
        startTransition(async () => {
            if (circleData._id) {
                const result = await saveGenresAction(genres, circleData.primaryGenreOther, circleData._id);
                if (result.success && result.data?.circle) {
                    const circle = result.data.circle as any;
                    setCircleData((prev) => ({
                        ...prev,
                        primaryGenres: circle.primaryGenres || prev.primaryGenres,
                        primaryGenreOther: circle.primaryGenreOther ?? prev.primaryGenreOther,
                    }));
                }
            }
            onSaved();
        });
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">{`${entityLabel} Genres`}</h2>
                <p className="text-sm text-muted-foreground">
                    {`Optional — helps people find this ${entityLabelLower} through genre search and the map filters.`}
                </p>
            </div>

            <CheckboxGroup
                label="Genres"
                options={PRIMARY_GENRE_OPTIONS}
                values={genres}
                onChange={(values) => setCircleData((prev) => ({ ...prev, primaryGenres: values }))}
                maxSelections={PRIMARY_GENRE_MAX_SELECTIONS}
            />

            {genres.includes("Other") && (
                <div className="space-y-2">
                    <Label htmlFor="primaryGenreOther">Genre (other)</Label>
                    <Input
                        id="primaryGenreOther"
                        value={circleData.primaryGenreOther || ""}
                        onChange={(e) => setCircleData((prev) => ({ ...prev, primaryGenreOther: e.target.value }))}
                        placeholder="e.g. fluffmetal"
                    />
                </div>
            )}

            <div className="flex justify-between">
                <Button onClick={prevStep} variant="outline" className="rounded-full" disabled={isPending}>
                    Back
                </Button>
                <div className="flex gap-2">
                    <Button onClick={nextStep} variant="ghost" className="rounded-full" disabled={isPending}>
                        Skip
                    </Button>
                    <Button onClick={() => save(nextStep)} className="w-[100px] rounded-full" disabled={isPending}>
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Next"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
