"use client";

import { useEffect, useState, useMemo } from "react";
import { Cause, CircleLevel, CircleType, Skill } from "@/models/models";
import { useRouter, useSearchParams } from "next/navigation";
import BasicInfoStep from "./basic-info-step";
import PurposeStep from "./purpose-step";
import ProfileStep from "./profile-step";
import GenreStep from "./genre-step";
import LocationStep from "./location-step";
// import SdgsStep from "./sdgs-step";
import SkillsStep from "./skills-step";
import InviteStep from "./invite-step";
import FinalStep from "./final-step";
import { Location, Media } from "@/models/models";
import { Card, CardContent } from "../ui/card";

const DEFAULT_CIRCLE_PICTURE = "/images/default-circle-picture.svg";

export type CircleData = {
    _id?: string; // Added circle ID
    name: string;
    handle: string;
    isPublic: boolean;
    mission: string;
    description: string;
    content: string;
    location?: Location;
    searchable?: boolean;
    selectedSdgs: Cause[];
    selectedSkills: Skill[];
    primaryGenres?: string[];
    primaryGenreOther?: string;
    picture: string; // Keep profile picture string for now
    // cover: string; // Remove cover string
    images: any[]; // Add images array
    parentCircleId?: string;
    circleLevel?: CircleLevel;
    pictureFile?: File; // Keep profile picture file for now
    // coverFile?: File; // Remove cover file
    circleType?: CircleType; // Should default to "circle"
    websiteUrl?: string;
    representsOrganization?: boolean;
    organizationName?: string;
    officialEmail?: string;
};

export type CircleWizardStepProps = {
    circleData: CircleData;
    setCircleData: React.Dispatch<React.SetStateAction<CircleData>>;
    nextStep: () => void;
    prevStep: () => void;
    onComplete?: (createdCircleId?: string, handle?: string) => void;
    initialParentCircleId?: string;
};

interface CircleWizardProps {
    onComplete?: (createdCircleId?: string, handle?: string) => void; // Modified to pass createdCircleId
    initialParentCircleId?: string;
    initialCircleType?: CircleType;
}

export default function CircleWizard({ onComplete, initialParentCircleId, initialCircleType }: CircleWizardProps) {
    const [isOpen, setIsOpen] = useState(true);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const router = useRouter();

    const [circleData, setCircleData] = useState<CircleData>({
        name: "",
        handle: "",
        isPublic: true,
        mission: "",
        description: "",
        content: "",
        selectedSdgs: [],
        selectedSkills: [],
        picture: DEFAULT_CIRCLE_PICTURE,
        images: [], // Initialize images as empty array
        parentCircleId: undefined, // Initialized as undefined, BasicInfoStep will set it
        circleLevel: initialParentCircleId ? "profile_child" : "profile_child",
        circleType: initialCircleType || "circle", // Default based on prop
        websiteUrl: "",
        representsOrganization: false,
        organizationName: "",
        officialEmail: "",
    });

    // Effect to reset state if key props change (indicating a new wizard session)
    useEffect(() => {
        if (isOpen) {
            console.log("Wizard is opening, resetting state.");
            setCircleData({
                name: "",
                handle: "",
                isPublic: true,
                mission: "",
                description: "",
                content: "",
                selectedSdgs: [],
                selectedSkills: [],
                picture: DEFAULT_CIRCLE_PICTURE,
                images: [],
                parentCircleId: initialParentCircleId, // Set initial parentCircleId
                circleLevel: initialParentCircleId ? "profile_child" : "profile_child",
                circleType: initialCircleType || "circle",
                _id: undefined,
                pictureFile: undefined,
                websiteUrl: "",
                representsOrganization: false,
                organizationName: "",
                officialEmail: "",
            });
            setCurrentStepIndex(0);
        }
    }, [isOpen, initialParentCircleId, initialCircleType]);

    // Define the steps for the wizard
    const steps = useMemo(() => {
        // Mapping of step components
        const stepComponents: React.ComponentType<CircleWizardStepProps>[] = [
            BasicInfoStep,
            PurposeStep,
            ProfileStep,
            GenreStep,
            LocationStep,
            // SdgsStep,
            // SkillsStep,
            InviteStep,
            FinalStep,
        ];

        // Convert to step objects with titles
        return stepComponents.map((Component, index) => ({
            id: `step-${index}`,
            component: Component,
            title: getStepTitle(index),
        }));
    }, []);

    // Helper function to get step titles
    function getStepTitle(stepIndex: number) {
        const entityType = circleData.circleType === "project" ? "Project" : "Circle";
        switch (stepIndex) {
            case 0:
                return "Basic Information";
            case 1:
                return `${entityType} Purpose`;
            case 2:
                return `${entityType} Profile`;
            case 3:
                return `${entityType} Genres`;
            case 4:
                return `${entityType} Location`;
            case 5:
                return "Invite People";
            case 6:
                return `${entityType} Summary`;
            default:
                return `${entityType} Creation`;
        }
    }

    const totalSteps = steps.length;

    const nextStep = () => {
        if (currentStepIndex + 1 < steps.length) {
            // Explicitly set the next step index
            const nextStepIndex = currentStepIndex + 1;
            setCurrentStepIndex(nextStepIndex);
        } else {
            // This is the final step completion
            setIsOpen(false);
            if (onComplete) {
                onComplete(circleData._id, circleData.handle); // Pass the created circle's ID
            } else {
                // Default navigation if onComplete is not provided
                if (circleData._id) {
                    router.push(`/circles/${circleData.handle || circleData._id}`);
                } else {
                    router.push("/circles"); // Always "/circles" now
                }
            }
        }
    };

    const prevStep = () => {
        if (currentStepIndex > 0) {
            setCurrentStepIndex(currentStepIndex - 1);
        }
    };

    const CurrentStepComponent = steps[currentStepIndex]?.component;

    if (!isOpen) {
        return null;
    }

    return (
        <div className={`${!isOpen ? "hidden" : ""} flex items-center justify-center p-0`}>
            <Card className="max-h-[90vh] w-full max-w-xl overflow-hidden rounded-2xl border-0 bg-background shadow-xl">
                <CardContent className="max-h-[calc(90vh-2rem)] space-y-6 overflow-y-auto p-6 sm:p-8">
                    <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {steps[currentStepIndex].title}
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                                className="h-full rounded-full bg-[hsl(var(--button-primary))] transition-all"
                                style={{ width: `${((currentStepIndex + 1) / totalSteps) * 100}%` }}
                            />
                        </div>
                    </div>
                    <CurrentStepComponent
                        circleData={circleData}
                        setCircleData={setCircleData}
                        nextStep={nextStep}
                        prevStep={prevStep}
                        onComplete={onComplete}
                        initialParentCircleId={initialParentCircleId}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
