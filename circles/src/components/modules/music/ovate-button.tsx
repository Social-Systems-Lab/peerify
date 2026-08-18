"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PiHandsClapping, PiHandsClappingFill } from "react-icons/pi";
import { Circle, UserPrivate } from "@/models/models";
import { isAuthorized } from "@/lib/auth/client-auth";
import { features } from "@/lib/data/constants";
import { cn } from "@/lib/utils";
import { ReactionTapBurst } from "@/components/modules/feeds/post-list";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { playOvationTick } from "@/lib/audio/ovation-tick";
import { ovateTrackAction } from "./ovation-actions";

const OVATION_HINT_DISMISSED_KEY = "peerify_ovation_tap_hint_dismissed";

// Only the first OvateButton mounted on a page shows the one-time explainer —
// a track list renders one instance per row, and without this latch every row
// would independently read localStorage as "not yet dismissed" in the same
// tick and pop the coach-mark open simultaneously on first load.
let hintClaimedThisPageLoad = false;

type OvateButtonProps = {
    trackId: string;
    circle: Circle;
    user: UserPrivate | null;
};

// Fan-facing ovation ("clap") tap. Repeatable and uncapped — every tap replays the
// burst animation and fires the increment; the fan never sees a count, their own or
// aggregate, before or after tapping. That animation (plus the persistent size bump
// and tick sound once active) is the entire feedback loop.
export const OvateButton: React.FC<OvateButtonProps> = ({ trackId, circle, user }) => {
    const [tapCount, setTapCount] = useState(0);
    const [showHint, setShowHint] = useState(false);
    const canReact = isAuthorized(user ?? undefined, circle, features.music.react);

    useEffect(() => {
        if (!canReact || hintClaimedThisPageLoad) return;

        try {
            if (localStorage.getItem(OVATION_HINT_DISMISSED_KEY) === "true") {
                return;
            }
        } catch {
            // localStorage unavailable (private mode etc.) — show the hint anyway
        }

        hintClaimedThisPageLoad = true;
        setShowHint(true);

        try {
            localStorage.setItem(OVATION_HINT_DISMISSED_KEY, "true");
        } catch {
            // localStorage unavailable — hint just won't remember it was shown
        }

        const timer = setTimeout(() => setShowHint(false), 4500);
        return () => clearTimeout(timer);
    }, [canReact]);

    const handleTap = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!canReact) return;
        setShowHint(false);
        setTapCount((n) => n + 1);
        playOvationTick();
        ovateTrackAction(trackId).catch(() => {});
    };

    // Persistent once active, on top of the per-tap transient pulse below — not
    // instead of the existing color/fill change, which already persists via the
    // always-mounted-once-tapped ReactionTapBurst overlay.
    const iconSizeClass = tapCount > 0 ? "h-5 w-5" : "h-4 w-4";

    return (
        <TooltipProvider>
            <Tooltip open={showHint} onOpenChange={setShowHint}>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={handleTap}
                        disabled={!canReact}
                        aria-label="Give an ovation"
                        className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center text-gray-500 transition-colors hover:text-[#FE801B] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <motion.div
                            key={tapCount}
                            initial={{ scale: 1 }}
                            animate={tapCount > 0 ? { scale: [1, 1.3, 1] } : { scale: 1 }}
                            transition={{ duration: 0.3 }}
                        >
                            <PiHandsClapping className={iconSizeClass} />
                        </motion.div>
                        {tapCount > 0 && (
                            <ReactionTapBurst triggerKey={tapCount}>
                                <PiHandsClappingFill className={cn(iconSizeClass, "text-[#FE801B]")} />
                            </ReactionTapBurst>
                        )}
                    </button>
                </TooltipTrigger>
                <TooltipContent side="top">Tap to applaud — let the artist know you love this song</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

export default OvateButton;
