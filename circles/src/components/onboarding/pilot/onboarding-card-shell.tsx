"use client";

import { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type OnboardingCardShellProps = {
    title: string;
    subtitle?: string;
    stepLabel?: string;
    progress?: number;
    // Only passed by frames within a counted phase (see phaseInfo in pilot-onboarding-flow.tsx)
    // — the role-aware explainer and completion screens never pass these, so they render with
    // no Back control at all, same as they render with no step counter.
    onBack?: () => void;
    canGoBack?: boolean;
    children: ReactNode;
    footer?: ReactNode;
};

// Shared visual shell for every card in the pilot onboarding sequence (both fan and artist
// paths) — plain Tailwind/shadcn Card, no bespoke styling from the design mockup this flow was
// specced from.
export function OnboardingCardShell({
    title,
    subtitle,
    stepLabel,
    progress,
    onBack,
    canGoBack,
    children,
    footer,
}: OnboardingCardShellProps) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8">
            <Card className="w-full max-w-lg">
                <CardContent className="space-y-6 p-6 sm:p-8">
                    {onBack ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="-ml-2 -mt-2 h-8 gap-1 px-2 text-muted-foreground disabled:opacity-40"
                            onClick={onBack}
                            disabled={!canGoBack}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            Back
                        </Button>
                    ) : null}

                    {(stepLabel || progress !== undefined) && (
                        <div className="space-y-2">
                            {stepLabel ? (
                                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    {stepLabel}
                                </div>
                            ) : null}
                            {progress !== undefined ? (
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                    <div
                                        className="h-full rounded-full bg-primary transition-all"
                                        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                                    />
                                </div>
                            ) : null}
                        </div>
                    )}

                    <div className="space-y-2">
                        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
                    </div>

                    <div>{children}</div>

                    {footer ? <div className="flex flex-col gap-3 pt-2 sm:flex-row">{footer}</div> : null}
                </CardContent>
            </Card>
        </div>
    );
}
