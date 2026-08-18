"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { PiHandsClapping, PiHandsClappingFill } from "react-icons/pi";
import { Circle, UserPrivate } from "@/models/models";
import { isAuthorized } from "@/lib/auth/client-auth";
import { features } from "@/lib/data/constants";
import { ReactionTapBurst } from "@/components/modules/feeds/post-list";
import { ovateTrackAction } from "./ovation-actions";

type OvateButtonProps = {
    trackId: string;
    circle: Circle;
    user: UserPrivate | null;
};

// Fan-facing ovation ("clap") tap. Repeatable and uncapped — every tap replays the
// burst animation and fires the increment; the fan never sees a count, their own or
// aggregate, before or after tapping. That animation is the entire feedback loop.
export const OvateButton: React.FC<OvateButtonProps> = ({ trackId, circle, user }) => {
    const [tapCount, setTapCount] = useState(0);
    const canReact = isAuthorized(user ?? undefined, circle, features.music.react);

    const handleTap = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!canReact) return;
        setTapCount((n) => n + 1);
        ovateTrackAction(trackId).catch(() => {});
    };

    return (
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
                <PiHandsClapping className="h-4 w-4" />
            </motion.div>
            {tapCount > 0 && (
                <ReactionTapBurst triggerKey={tapCount}>
                    <PiHandsClappingFill className="h-4 w-4 text-[#FE801B]" />
                </ReactionTapBurst>
            )}
        </button>
    );
};

export default OvateButton;
