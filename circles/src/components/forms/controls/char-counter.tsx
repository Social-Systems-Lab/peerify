"use client";

import { cn } from "@/lib/utils";

interface CharCounterProps {
    value: string;
    max: number;
    className?: string;
}

// Matches the plain "{length}/{max}" counter pattern already used elsewhere (e.g. about-step.tsx,
// join-crew-dialog.tsx, rsvp-dialog.tsx), but also handles a value that's already over `max` —
// those maxLength attributes only block further typing, they don't truncate a pre-loaded value
// (e.g. an offer saved before this cap existed/was raised). In that case the count switches to a
// negative "how far over" number so it reads unambiguously as "you're over", using the same
// text-destructive color shadcn's own FormMessage/Alert components use for errors.
export function CharCounter({ value, max, className }: CharCounterProps) {
    const remaining = max - value.length;
    const isOverLimit = remaining < 0;

    return (
        <p className={cn("text-right text-xs text-muted-foreground", isOverLimit && "text-destructive", className)}>
            {isOverLimit ? remaining : value.length} / {max}
        </p>
    );
}
