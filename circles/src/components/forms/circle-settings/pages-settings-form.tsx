"use client";

import React, { useState } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Circle, ModuleInfo } from "@/models/models";
import { useRouter } from "next/navigation";
import { setModuleEnabledAction } from "@/app/circles/[handle]/settings/pages/actions";
import { hiddenPublicModuleHandles, modules } from "@/lib/data/constants";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { getUserPrivateAction } from "@/components/modules/home/actions";

interface PagesSettingsFormProps {
    circle: Circle;
}

export function PagesSettingsForm({ circle }: PagesSettingsFormProps): React.ReactElement {
    // Get all available modules from features
    const availableModules: ModuleInfo[] = modules.filter(
        (module) => !hiddenPublicModuleHandles.includes(module.handle),
    );

    return (
        <div className="formatted space-y-6">
            <div className="space-y-4">
                {availableModules.map((module) => (
                    <ModuleEnabledToggle key={module.handle} circle={circle} module={module} />
                ))}
            </div>
        </div>
    );
}

// Mirrors CrewEnabledToggle in about-settings-form.tsx — each module toggle auto-saves on
// click instead of going through a shared Save Changes button, so toggling one module never
// requires or triggers a save of any other module's state.
const ModuleEnabledToggle = ({ circle, module }: { circle: Circle; module: ModuleInfo }) => {
    const { toast } = useToast();
    const router = useRouter();
    const [user, setUser] = useAtom(userAtom);
    const [enabled, setEnabled] = useState((circle.enabledModules ?? []).includes(module.handle));
    const [isSaving, setIsSaving] = useState(false);
    const [justSaved, setJustSaved] = useState(false);

    const isLocked =
        module.readOnly || (module.handle === "funding" && (!user?.isAdmin || circle.circleType !== "circle"));

    const onToggle = async (checked: boolean) => {
        setIsSaving(true);
        setJustSaved(false);
        setEnabled(checked);
        const res = await setModuleEnabledAction(circle._id ?? "", module.handle, checked);
        setIsSaving(false);
        if (!res.success) {
            setEnabled(!checked);
            toast({
                title: "Error",
                description: res.message || "Failed to update module setting",
                variant: "destructive",
            });
            return;
        }

        // enabledModules also drives the app's nav, so refresh the user atom and the
        // server-rendered page the same way the old batch save did.
        const userData = await getUserPrivateAction();
        setUser(userData);
        router.refresh();

        setJustSaved(true);
        window.setTimeout(() => setJustSaved(false), 1500);
    };

    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">
                        {/* Label's own default text-sm/font-medium would otherwise override CardTitle's
                            text-lg on this element — restore the original heading size/weight explicitly. */}
                        <Label htmlFor={`module-toggle-${module.handle}`} className="text-lg font-semibold tracking-tight">
                            {module.name}
                        </Label>
                    </CardTitle>
                    <div className="flex shrink-0 items-center gap-2">
                        {justSaved && <span className="text-xs text-muted-foreground">Saved</span>}
                        <Switch
                            id={`module-toggle-${module.handle}`}
                            checked={enabled}
                            onCheckedChange={onToggle}
                            disabled={isLocked || isSaving}
                            aria-readonly={isLocked}
                            // Scoped to this instance only (not switch.tsx's default styling) — matches the
                            // brand green used by Save Changes/Pledge Interest/Post (--button-primary), not
                            // Switch's own default on-color (--primary, a dark navy). Every other Switch in
                            // the app renders bare with no className override, so none is affected.
                            className="data-[state=checked]:bg-[hsl(var(--button-primary))]"
                        />
                    </div>
                </div>
                <CardDescription>
                    {module.description}
                    {module.handle === "funding" ? (
                        <span className="mt-1.5 block">MVP: circles only. Super Admins only.</span>
                    ) : null}
                </CardDescription>
            </CardHeader>
        </Card>
    );
};
