"use client";

import { usePathname } from "next/navigation";
import { isPilotChromePath } from "@/lib/peerify/pilot-chrome";

// Wraps HomeCover/HomeContent/CircleTabs/{children} and applies the new visual-identity
// pilot palette/fonts (see globals.css ".pilot-chrome" rules), but only when the exact
// pilot route is being viewed — visiting other tabs of the same circle (settings, tasks,
// etc.) falls back to the current look. Only mounted at all for the pilot handle (see
// circles/[handle]/layout.tsx), so it's a no-op for every other circle.
export function PilotChromeScope({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const active = isPilotChromePath(pathname);

    return <div className={active ? "pilot-chrome pilot-chrome-page" : undefined}>{children}</div>;
}
