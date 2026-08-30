// crew-landing.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { useRouter } from "next/navigation";
import { userAtom } from "@/lib/data/atoms";
import { Circle } from "@/models/models";
import { Button } from "@/components/ui/button";
import { CirclePicture } from "@/components/modules/circles/circle-picture";
import JoinCrewDialog from "@/components/modules/home/join-crew-dialog";
import { getCrewMembershipStatusAction } from "./actions";

type CrewLandingProps = {
    circle: Circle;
};

// Shown instead of the real Crew page content (member rail, feed, Offers) to anyone who isn't
// an approved Crew member or this circle's own admin/moderator — including logged-out
// visitors. Never reachable for someone who IS eligible: crew.tsx only renders this branch when
// the server-side eligibility check already came back false, so the only real states here are
// "never applied," "pending," and "logged out" — never "approved" (that's the eligible branch).
export default function CrewLanding({ circle }: CrewLandingProps) {
    const router = useRouter();
    const [user] = useAtom(userAtom);
    const [isJoinCrewDialogOpen, setIsJoinCrewDialogOpen] = useState(false);
    const [status, setStatus] = useState<"none" | "pending">("none");

    useEffect(() => {
        if (!user?.did || !circle?._id) {
            return;
        }
        let isCurrent = true;
        getCrewMembershipStatusAction(circle._id).then((result) => {
            if (isCurrent && result.status !== "approved") {
                setStatus(result.status === "pending" ? "pending" : "none");
            }
        });
        return () => {
            isCurrent = false;
        };
    }, [user?.did, circle?._id]);

    const openJoinCrewDialog = () => {
        if (!user?.did) {
            router.push(`/login?redirectTo=${encodeURIComponent(`/circles/${circle.handle}/crew`)}`);
            return;
        }
        setIsJoinCrewDialogOpen(true);
    };

    return (
        <div className="flex flex-col items-center gap-4 rounded-[18px] border border-black/5 bg-white p-10 text-center shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
            <CirclePicture circle={circle} size="72px" />
            <div>
                <h1 className="text-xl font-semibold">{circle.name}&apos;s Crew</h1>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                    Crew members actively support {circle.name} — advice, local knowledge, spreading the word, and more.
                    Apply to join and get involved.
                </p>
            </div>
            {status === "pending" ? (
                <Button disabled className="bg-[#1A1612] text-white hover:bg-[#2b2621]">
                    Application Pending
                </Button>
            ) : (
                <Button className="bg-[#1A1612] text-white hover:bg-[#2b2621]" onClick={openJoinCrewDialog}>
                    Join Crew
                </Button>
            )}
            <JoinCrewDialog
                circle={circle}
                open={isJoinCrewDialogOpen}
                onOpenChange={setIsJoinCrewDialogOpen}
                onApplied={() => setStatus("pending")}
            />
        </div>
    );
}
