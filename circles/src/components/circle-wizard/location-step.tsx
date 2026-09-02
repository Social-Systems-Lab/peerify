"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CircleWizardStepProps } from "./circle-wizard";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Location } from "@/models/models";
import LocationPicker from "@/components/forms/location-picker";
import { saveLocationAction } from "./actions";

export default function LocationStep({ circleData, setCircleData, nextStep, prevStep }: CircleWizardStepProps) {
    const [isPending, startTransition] = useTransition();
    const [locationError, setLocationError] = useState("");
    const [searchable, setSearchable] = useState(circleData.searchable ?? true);
    const entityLabel = circleData.circleType === "project" ? "Project" : "Circle";
    const entityLabelLower = entityLabel.toLowerCase();

    const handleLocationChange = (location: Location | undefined) => {
        // Clear any previous errors
        setLocationError("");

        // Update the circle data
        setCircleData((prev) => ({
            ...prev,
            location,
        }));
    };

    const saveAndAdvance = () => {
        startTransition(async () => {
            // No location set — nothing to save, just move on.
            if (!circleData.location?.lngLat || !circleData._id) {
                nextStep();
                return;
            }

            const result = await saveLocationAction(circleData.location, circleData._id, searchable);

            if (result.success) {
                if (result.data?.circle) {
                    const circle = result.data.circle as any;
                    setCircleData((prev) => ({
                        ...prev,
                        location: circle.location || prev.location,
                        searchable: circle.searchable ?? prev.searchable,
                    }));
                }
                nextStep();
            } else {
                setLocationError(result.message || "Failed to save location");
                console.error(result.message);
            }
        });
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">{`${entityLabel} Location`}</h2>
                <p className="text-gray-500">
                    {`Optional — add a location to help people find this ${entityLabelLower} and connect with nearby members.`}
                </p>
            </div>

            <Card>
                <CardContent className="space-y-4 pt-6">
                    <Label>{`${entityLabel} Location`}</Label>
                    <LocationPicker value={circleData.location} onChange={handleLocationChange} compact={true} />

                    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                        <div>
                            <Label htmlFor="circle-searchable" className="text-sm font-medium">
                                Show me in search
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {`Independent of the map — this ${entityLabelLower} can be searchable even without a location set.`}
                            </p>
                        </div>
                        <Switch id="circle-searchable" checked={searchable} onCheckedChange={setSearchable} />
                    </div>
                </CardContent>
            </Card>

            <p className="text-center text-sm text-gray-500">
                You can adjust the precision level to control how specific your location appears to others
            </p>

            {locationError && <p className="text-sm text-red-500">{locationError}</p>}

            <div className="flex justify-between">
                <Button onClick={prevStep} variant="outline" className="rounded-full" disabled={isPending}>
                    Back
                </Button>
                <div className="flex gap-2">
                    <Button onClick={nextStep} variant="ghost" className="rounded-full" disabled={isPending}>
                        Skip for now
                    </Button>
                    <Button
                        onClick={saveAndAdvance}
                        className="w-[100px] rounded-full"
                        disabled={isPending}
                    >
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Next"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
