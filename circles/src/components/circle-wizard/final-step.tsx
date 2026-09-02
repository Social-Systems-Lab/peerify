import { Button } from "@/components/ui/button";
import { CircleWizardStepProps } from "./circle-wizard";

export default function FinalStep({ circleData, prevStep, onComplete }: CircleWizardStepProps) {
    const entityLabel = circleData.circleType === "project" ? "Project" : "Circle";
    const entityLabelLower = entityLabel.toLowerCase();
    const genres = circleData.primaryGenres || [];
    const locationLabel = [circleData.location?.city, circleData.location?.country].filter(Boolean).join(", ");

    const handleSaveDraft = () => {
        if (onComplete) {
            onComplete(circleData._id, circleData.handle);
        }
    };

    return (
        <div className="space-y-6">
            <h2 className="text-center text-3xl font-bold">Save your draft</h2>
            <p className="text-center text-gray-600">
                {`Your ${entityLabelLower} will be saved as a draft so you can keep editing it before it goes live.`}
            </p>

            <div className="rounded-lg border bg-white p-6 shadow-sm">
                <h3 className="mb-4 text-xl font-semibold">{`${entityLabel} Summary`}</h3>
                <div className="space-y-4">
                    <div>
                        <p className="font-medium">Name</p>
                        <p className="text-gray-700">{circleData.name}</p>
                    </div>
                    <div>
                        <p className="font-medium">Purpose</p>
                        <p className="text-gray-700">{circleData.mission}</p>
                    </div>
                    {genres.length > 0 && (
                        <div>
                            <p className="font-medium">Genres</p>
                            <div className="mt-1 flex flex-wrap gap-2">
                                {genres.map((genre) => (
                                    <span key={genre} className="rounded-full bg-gray-200 px-2 py-1 text-xs">
                                        {genre}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    {locationLabel && (
                        <div>
                            <p className="font-medium">Location</p>
                            <p className="text-gray-700">{locationLabel}</p>
                        </div>
                    )}
                </div>
            </div>
            <div className="flex items-center justify-between pt-4">
                <Button onClick={prevStep} variant="outline" className="rounded-full">
                    Back
                </Button>
                <Button onClick={handleSaveDraft} className="rounded-full">
                    Save draft
                </Button>
            </div>
        </div>
    );
}
