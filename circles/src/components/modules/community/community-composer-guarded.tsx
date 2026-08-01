// community-composer-guarded.tsx
"use client";

import { useState } from "react";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { Circle } from "@/models/models";
import { UserPicture } from "@/components/modules/members/user-picture";
import { CommunityParticipationDialog } from "./community-participation-dialog";
import type { ParticipationState } from "@/lib/auth/participation-readiness";

type GuardedCommunityComposerProps = {
    circle: Circle;
    participation: ParticipationState;
};

// Composer-shaped prompt shown when a user has community.post permission but
// isn't participation-ready yet (see CommunityFeed). Looks like the real
// collapsed composer, but never expands into a real editor — clicking or
// focusing it only opens the readiness dialog. No typing, no media
// selection; the real CommunityComposer only mounts once canParticipate.
export function GuardedCommunityComposer({ circle, participation }: GuardedCommunityComposerProps) {
    const [user] = useAtom(userAtom);
    const [dialogOpen, setDialogOpen] = useState(false);

    return (
        <div className="mb-4 flex flex-col gap-3 rounded-[15px] border-0 bg-white p-2 shadow-sm">
            <div className="flex items-start gap-3">
                <UserPicture name={user?.name} picture={user?.picture?.url} size="40px" />
                <button
                    type="button"
                    onClick={() => setDialogOpen(true)}
                    onFocus={() => setDialogOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={dialogOpen}
                    className="w-full cursor-pointer rounded-full bg-gray-100 p-2 pl-4 text-left text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    Complete your personal profile to post in the Community
                </button>
            </div>
            <CommunityParticipationDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                participation={participation}
                profileHandle={user?.handle}
            />
        </div>
    );
}
