// Run: IS_BUILD=true bun test src/components/forms/circle-settings/discoverability-card.test.tsx
// "Show me on the map" is hidden on personal profiles (Tim, 2026-11-23): since 2026-11-02 a
// personal profile never gets a pin (getSwipeCircles), so the switch promised something that
// didn't happen. "Show me in search" stays. Renders the About settings form for a personal profile.

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
    usePathname: () => "/circles/someone/settings/about",
    useSearchParams: () => new URLSearchParams(),
}));

const { AboutSettingsForm } = await import("./about-settings-form");

const personal = (extra: Record<string, unknown> = {}) =>
    ({
        _id: "650000000000000000000101",
        did: "did:test:someone",
        handle: "someone",
        name: "Someone",
        circleType: "user",
        publishStatus: "published",
        ...extra,
    }) as any;

describe("About settings: the Discoverability card on a personal profile", () => {
    for (const mapVisible of [false, true]) {
        test(`no "Show me on the map" switch (stored mapVisible: ${mapVisible}); search switch stays`, () => {
            const html = renderToStaticMarkup(<AboutSettingsForm circle={personal({ mapVisible })} />);
            expect(html).toContain("Discoverability");
            expect(html).toContain("Show me in search");
            expect(html).not.toContain("Show me on the map");
            expect(html).not.toContain("appear as a pin on the public map");
        });
    }
});
