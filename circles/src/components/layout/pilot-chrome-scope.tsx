"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isCircleHomePath, isPilotChromePath } from "@/lib/peerify/pilot-chrome";

// Wraps HomeCover/HomeContent/CircleTabs/{children} for every circle (see
// circles/[handle]/layout.tsx) and applies two independently-scoped sets of pilot rules,
// based on the current pathname:
//
// - .pilot-chrome/.pilot-chrome-page (badges, the --primary/--ring tab-accent color):
//   still exactly as narrow as the original single-page pilot — only tim-admin's own
//   profile. Not part of this round's shell extension.
// - .circle-home-headings (heading font-weight): any circle's /home tab now gets this,
//   not just tim-admin's — see pilot-chrome.ts for why heading-weight specifically was
//   widened while badges/tab-accent weren't.
export function PilotChromeScope({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isPilotPage = isPilotChromePath(pathname);
    const isCircleHomePage = isCircleHomePath(pathname);

    return (
        <div className={cn(isPilotPage && "pilot-chrome pilot-chrome-page", isCircleHomePage && "circle-home-headings")}>
            {children}
        </div>
    );
}
