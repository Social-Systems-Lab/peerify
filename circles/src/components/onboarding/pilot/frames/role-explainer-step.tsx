"use client";

import { Button } from "@/components/ui/button";

type RoleExplainerStepProps = {
    role: "fan" | "artist";
    onGoToProfile: () => void;
    onContinueSetup: () => void;
};

// Shown right after Community Guidelines are signed, before branching into the role-specific
// path. Fan gets an escape hatch straight into the app; artist does not — picking the artist
// path at signup is the commitment to set up a public artist profile.
export function RoleExplainerStep({ role, onGoToProfile, onContinueSetup }: RoleExplainerStepProps) {
    if (role === "fan") {
        return (
            <div className="space-y-6">
                <p className="text-sm text-muted-foreground">
                    You can adjust your visibility anytime in Settings. You can start interacting now, but there are a
                    few more optional details that can help us get you set up so you can make the most of Peerify.
                </p>
                <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                    <Button type="button" variant="outline" className="sm:flex-1" onClick={onGoToProfile}>
                        Go to profile
                    </Button>
                    <Button type="button" className="sm:flex-1" onClick={onContinueSetup}>
                        Continue setup
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
                It&apos;s off the public map by default, but findable by search — you can refine it anytime in
                Settings. Now let&apos;s set up your public artist profile.
            </p>
            <Button type="button" className="w-full" onClick={onContinueSetup}>
                Continue setup
            </Button>
        </div>
    );
}
