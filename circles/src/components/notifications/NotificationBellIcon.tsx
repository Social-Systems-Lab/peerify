"use client";

import React, { useEffect, useState } from "react";
import { BsMegaphone } from "react-icons/bs";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Extend Button props to ensure compatibility with PopoverTrigger asChild
// Omit 'children' as NotificationBellIcon provides its own child (the notification icon).
// Also omit 'size' from ButtonProps to avoid conflict, we'll use iconSize for the icon.
interface NotificationBellIconProps extends Omit<React.ComponentPropsWithoutRef<typeof Button>, "children" | "size"> {
    iconSize?: number; // Renamed from 'size' to avoid conflict with Button's 'size' prop
}

const NOTIFICATION_HINT_DISMISSED_KEY = "peerify_notification_bell_hint_dismissed";

// Same one-time-coach-mark latch as OvateButton's explainer (src/components/modules/music/ovate-button.tsx):
// this icon renders multiple times on a single circle's home page, so without a page-load latch every
// instance would independently read localStorage as "not yet dismissed" and pop its hint open at once.
let hintClaimedThisPageLoad = false;

export const NotificationBellIcon: React.FC<NotificationBellIconProps> = ({
    onClick,
    className,
    iconSize = 20, // Default size for the notification icon
    ...props // Spread other props (like those from PopoverTrigger)
}) => {
    const [showHint, setShowHint] = useState(false);

    useEffect(() => {
        if (hintClaimedThisPageLoad) return;

        try {
            if (localStorage.getItem(NOTIFICATION_HINT_DISMISSED_KEY) === "true") {
                return;
            }
        } catch {
            // localStorage unavailable (private mode etc.) — show the hint anyway
        }

        hintClaimedThisPageLoad = true;
        setShowHint(true);

        try {
            localStorage.setItem(NOTIFICATION_HINT_DISMISSED_KEY, "true");
        } catch {
            // localStorage unavailable — hint just won't remember it was shown
        }

        const timer = setTimeout(() => setShowHint(false), 4500);
        return () => clearTimeout(timer);
    }, []);

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        console.log("NotificationBellIcon internal handleClick. Event target:", event.target);
        setShowHint(false);
        if (onClick) {
            onClick(event); // Forward the event to the passed onClick handler
        }
    };

    return (
        <TooltipProvider>
            <Tooltip open={showHint} onOpenChange={setShowHint}>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon" // Explicitly set Button's own size prop to "icon"
                        onClick={handleClick} // Use the internal handleClick that forwards the event
                        className={className}
                        aria-label="Notification settings"
                        {...props} // Spread the rest of the props to the Button
                    >
                        <BsMegaphone size={iconSize} /> {/* Use iconSize for the notification icon */}
                    </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Manage what this circle notifies you about</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};
