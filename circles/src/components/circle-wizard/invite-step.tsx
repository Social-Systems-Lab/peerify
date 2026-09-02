"use client";

import { Button } from "@/components/ui/button";
import { CircleWizardStepProps } from "./circle-wizard";
import InviteButton from "@/components/modules/home/invite-button";
import { Circle } from "@/models/models";

export default function InviteStep({ circleData, nextStep, prevStep }: CircleWizardStepProps) {
    const inviteCircle = {
        _id: circleData._id,
        handle: circleData.handle,
        name: circleData.name,
        circleType: circleData.circleType,
    } as Circle;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Invite people</h2>
                <p className="text-sm text-muted-foreground">
                    Optional — share a link so people can start joining right away.
                </p>
            </div>

            <div className="flex justify-center py-4">
                <InviteButton circle={inviteCircle} />
            </div>

            <div className="flex justify-between">
                <Button onClick={prevStep} variant="outline" className="rounded-full">
                    Back
                </Button>
                <Button onClick={nextStep} className="w-[100px] rounded-full">
                    Next
                </Button>
            </div>
        </div>
    );
}
