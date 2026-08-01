"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import LocationPicker from "@/components/forms/location-picker";
import { Location } from "@/models/models";
import { savePilotLocationAction } from "@/app/onboarding/pilot/actions";

type LocationStepProps = {
    circleId: string;
    initialLocation?: Location;
    showSearchToggle: boolean;
    initialSearchable?: boolean;
    onSaved?: (location: Location, searchable?: boolean) => void;
    onContinue: () => void;
    onSkip: () => void;
};

export function LocationStep({
    circleId,
    initialLocation,
    showSearchToggle,
    initialSearchable,
    onSaved,
    onContinue,
    onSkip,
}: LocationStepProps) {
    const { toast } = useToast();
    const [location, setLocation] = useState<Location | undefined>(initialLocation);
    const [searchable, setSearchable] = useState(initialSearchable ?? true);
    const [isSaving, setIsSaving] = useState(false);

    const handleContinue = async () => {
        if (!location?.lngLat) {
            onContinue();
            return;
        }

        setIsSaving(true);
        try {
            const result = await savePilotLocationAction(circleId, location, showSearchToggle ? searchable : undefined);
            if (!result.success) {
                toast({ title: "Couldn't save location", description: result.message, variant: "destructive" });
                return;
            }
            onSaved?.(location, showSearchToggle ? searchable : undefined);
            onContinue();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <LocationPicker value={location} onChange={setLocation} compact />

            {showSearchToggle ? (
                <div className="space-y-2 rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-4">
                        <Label htmlFor="onboarding-searchable" className="text-sm font-medium">
                            Show me in search
                        </Label>
                        <Switch id="onboarding-searchable" checked={searchable} onCheckedChange={setSearchable} />
                    </div>
                    <p className="text-xs text-muted-foreground">Let friends find you by name, handle, or email.</p>
                    <p className="text-xs text-muted-foreground">
                        Even with search on, your profile stays minimal. Just your name and avatar.
                    </p>
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
