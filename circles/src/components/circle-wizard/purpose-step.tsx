"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CircleWizardStepProps } from "./circle-wizard";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { saveMissionAction } from "./actions";

export default function PurposeStep({ circleData, setCircleData, nextStep, prevStep }: CircleWizardStepProps) {
    const [isPending, startTransition] = useTransition();
    const [missionError, setMissionError] = useState("");

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const { name, value } = e.target;

        // Clear any previous errors
        setMissionError("");

        // Update the circle data
        setCircleData((prev) => ({
            ...prev,
            [name]: value,
        }));
    };

    const handleNext = () => {
        startTransition(async () => {
            // Validate purpose
            if (!circleData.mission.trim()) {
                setMissionError("Please describe what brings this circle together");
                return;
            }

            // If we have a circle ID, update the circle with the purpose
            if (circleData._id) {
                const result = await saveMissionAction(circleData.mission, circleData._id);

                if (result.success) {
                    // Update the circle data with any changes from the server
                    if (result.data?.circle) {
                        const circle = result.data.circle as any;
                        setCircleData((prev) => ({
                            ...prev,
                            mission: circle.mission || prev.mission,
                        }));
                    }
                    nextStep();
                } else {
                    // Handle error
                    setMissionError(result.message || "Failed to save purpose");
                    console.error(result.message);
                }
            } else {
                // If no circle ID yet, just store the purpose in state and move to the next step
                console.warn("No circle ID yet, purpose will be saved when the circle is created");
                nextStep();
            }
        });
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Circle Purpose</h2>
                <p className="text-sm text-muted-foreground">
                    A circle is a group or a community — anything from a small team with a mission to an ongoing fan
                    community.
                </p>
            </div>

            <div className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="mission">What brings this circle together?</Label>
                    <Textarea
                        id="mission"
                        name="mission"
                        value={circleData.mission}
                        onChange={handleInputChange}
                        placeholder="Fans of live indie folk in Cape Town, or: Everything about The Marshmallow Valentines"
                        className="h-32"
                    />
                    {missionError && <p className="text-sm text-red-500">{missionError}</p>}
                </div>
            </div>

            <div className="flex justify-between">
                <Button onClick={prevStep} variant="outline" className="rounded-full" disabled={isPending}>
                    Back
                </Button>
                <Button onClick={handleNext} className="w-[100px] rounded-full" disabled={isPending}>
                    {isPending ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                        </>
                    ) : (
                        "Next"
                    )}
                </Button>
            </div>
        </div>
    );
}
