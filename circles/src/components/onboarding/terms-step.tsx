"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { OnboardingStepProps } from "./onboarding";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { saveTermsAgreementAction } from "./actions";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function TermsStep({ nextStep }: OnboardingStepProps) {
    const [user, setUser] = useAtom(userAtom);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [agreedToTos, setAgreedToTos] = useState(false);
    const [agreedToEmailUpdates, setAgreedToEmailUpdates] = useState(false);
    const [activeTab, setActiveTab] = useState("terms");

    const handleNext = async () => {
        if (!user?._id) {
            nextStep();
            return;
        }

        setIsSubmitting(true);
        try {
            // Save terms agreement
            const response = await saveTermsAgreementAction(agreedToTos, agreedToEmailUpdates, user._id);

            if (response.success) {
                // Update local user state
                const updatedSteps = [...(user.completedOnboardingSteps || [])];
                if (!updatedSteps.includes("terms")) {
                    updatedSteps.push("terms");
                }

                setUser({
                    ...user,
                    completedOnboardingSteps: updatedSteps,
                    agreedToTos,
                    agreedToEmailUpdates,
                });

                nextStep();
            } else {
                console.error("Error saving terms agreement:", response.message);
                // Continue anyway
                nextStep();
            }
        } catch (error) {
            console.error("Error saving terms agreement:", error);
            nextStep(); // Continue anyway
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col space-y-2">
            <Tabs defaultValue="terms" className="w-full" value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="terms">Terms of Service</TabsTrigger>
                    <TabsTrigger value="privacy">Privacy Policy</TabsTrigger>
                </TabsList>
                <TabsContent
                    value="terms"
                    className="formatted max-h-[300px] overflow-y-auto rounded-md border bg-white p-4"
                >
                    {/* The terms themselves are the public /terms page (src/content/terms.md). A plain anchor,
                        because RichText only opens external links in a new tab. */}
                    <p>
                        Read our{" "}
                        <a
                            href="/terms"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-blue-600 underline"
                        >
                            Terms of Service
                        </a>{" "}
                        (opens in a new tab).
                    </p>
                </TabsContent>
                <TabsContent
                    value="privacy"
                    className="formatted max-h-[300px] overflow-y-auto rounded-md border bg-white p-4"
                >
                    {/* The policy itself is the public /privacy page (src/content/privacy-policy.md). A plain
                        anchor, because RichText only opens external links in a new tab. */}
                    <p>
                        Read our{" "}
                        <a
                            href="/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-blue-600 underline"
                        >
                            Privacy Policy
                        </a>{" "}
                        (opens in a new tab).
                    </p>
                </TabsContent>
            </Tabs>

            <div className="flex flex-col space-y-4 pt-4">
                <div className="flex items-center space-x-2">
                    <Checkbox
                        id="terms"
                        checked={agreedToTos}
                        onCheckedChange={(checked) => setAgreedToTos(checked as boolean)}
                    />
                    <label
                        htmlFor="terms"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                        I agree to the Terms of Service and Privacy Policy
                    </label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox
                        id="email"
                        checked={agreedToEmailUpdates}
                        onCheckedChange={(checked) => setAgreedToEmailUpdates(checked as boolean)}
                    />
                    <label
                        htmlFor="email"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                        I agree to receive email updates about Peerify (optional)
                    </label>
                </div>
            </div>

            <div className="flex justify-between">
                <div />
                <Button onClick={handleNext} disabled={!agreedToTos || isSubmitting}>
                    Continue
                </Button>
            </div>
        </div>
    );
}

export default TermsStep;
