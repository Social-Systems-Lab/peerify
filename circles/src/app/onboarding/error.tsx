"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useAtom } from "jotai";
import { Card, CardContent } from "@/components/ui/card";
import { userAtom } from "@/lib/data/atoms";
import { getCircleDefaultPath } from "@/lib/utils/circle-routes";

type OnboardingErrorProps = {
    error: Error & { digest?: string };
    reset: () => void;
};

// Error boundary for the onboarding segment (/onboarding/pilot, /onboarding/peerify). Every
// onboarding step saves when it's completed, so a crash only affects the current screen — the
// person can retry it or just carry on to their profile. The profile link goes straight to the
// module path (getCircleDefaultPath), not the bare /circles/<handle> redirect hop, same as the
// pilot flow's own end-screen buttons. Only the personal circle is known here (userAtom), so
// that's the destination; without it, fall back to the app home.
export default function OnboardingError({ error, reset }: OnboardingErrorProps) {
    const [user] = useAtom(userAtom);
    const profileHref = user?.handle ? getCircleDefaultPath(user) : "/";

    useEffect(() => {
        console.error("Onboarding error:", error);
    }, [error]);

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f2ea] px-6 text-center">
            <Card className="w-full max-w-md border-[#e3d5c2] bg-[#faf6ef] shadow-sm">
                <CardContent className="flex flex-col items-center px-8 py-10">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#e8720c]">Peerify</p>
                    <h1 className="mt-4 text-3xl font-semibold text-[#181512]">Something went wrong</h1>
                    <p className="mt-4 max-w-md text-[#6b5f52]">
                        Steps you&apos;ve already completed are saved. You can try this step again or carry on to your
                        profile.
                    </p>
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                        <button
                            type="button"
                            onClick={reset}
                            className="rounded-full border border-[#e3d5c2] px-5 py-3 text-sm font-semibold text-[#181512] hover:bg-[#f7f2ea]"
                        >
                            Try again
                        </button>
                        <Link
                            href={profileHref}
                            className="rounded-full bg-[#e8720c] px-5 py-3 text-sm font-semibold text-[#181512] hover:bg-[#ff8c2a]"
                        >
                            Continue to your profile
                        </Link>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
