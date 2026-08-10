"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { isPilotChromePath } from "@/lib/peerify/pilot-chrome";
import { cn } from "@/lib/utils";

// Wraps HomeCover/HomeContent/CircleTabs/{children} and applies the new visual-identity
// pilot accents (see globals.css ".pilot-chrome" rules — Option A: restrained accent,
// page/card backgrounds stay the site's normal white/neutral), but only when the exact
// pilot route is being viewed — visiting other tabs of the same circle (settings, tasks,
// etc.) falls back to the current look. Only mounted at all for the pilot handle (see
// circles/[handle]/layout.tsx), so it's a no-op for every other circle.
export function PilotChromeScope({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const active = isPilotChromePath(pathname);

    // Typography experiment, not a decision: headings default to Cormorant Garamond 500
    // (see globals.css); appending ?heading-weight=600 flips every heading on the page to
    // 600 for a live side-by-side comparison ahead of picking one.
    const headingWeight600 = searchParams.get("heading-weight") === "600";

    return (
        <div className={cn(active && "pilot-chrome", active && headingWeight600 && "heading-weight-600")}>
            {children}
        </div>
    );
}
