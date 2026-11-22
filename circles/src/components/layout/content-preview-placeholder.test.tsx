// Run: IS_BUILD=true bun test src/components/layout/content-preview-placeholder.test.tsx
// The private-profile placeholder in the preview panel (Tim, 2026-11-22): no follower count, no
// Followers link, no social links, no SDGs. A personal profile the owner hasn't made searchable
// starts suppressed (the relationship check runs in an effect, after this first render).

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
    usePathname: () => "/explore",
    useSearchParams: () => new URLSearchParams(),
}));
const realHomeActions = await import("@/components/modules/home/actions");
const realCrewActions = await import("@/components/modules/crew/actions");
mock.module("@/components/modules/home/actions", () => ({
    ...realHomeActions,
    getProfilePreviewAccessAction: async () => ({ hasAccess: false }),
    getViewerIsCircleAdminAction: async () => ({ isAdmin: false }),
}));
mock.module("@/components/modules/crew/actions", () => ({
    ...realCrewActions,
    getCrewMembershipStatusAction: async () => null,
}));

const { CirclePreview } = await import("./content-preview");

const person = (searchable: boolean) =>
    ({
        _id: "650000000000000000000021",
        did: "did:test:person",
        handle: "canary-person",
        name: "CANARY Real Name",
        circleType: "user",
        searchable,
        members: 43, // shown as 42 followers (the owner is a member of their own profile)
        socialLinks: [{ platform: "instagram", url: "https://instagram.com/CANARY-social" }],
        causes: ["sdg-1"],
        description: "CANARY description",
    }) as any;

describe("CirclePreview for a personal profile", () => {
    test("private placeholder: no follower count, Followers link, social links or SDGs", () => {
        const html = renderToStaticMarkup(<CirclePreview circle={person(false)} circleType="user" />);
        expect(html).toContain("This profile is private");
        expect(html).not.toContain("42");
        expect(html).not.toContain("Follower");
        expect(html).not.toContain("CANARY");
        expect(html).not.toContain("SDGs");
    });

    test("a profile shown in full still has its count and links", () => {
        const html = renderToStaticMarkup(<CirclePreview circle={person(true)} circleType="user" />);
        expect(html).toContain("42 Followers");
        expect(html).toContain("CANARY-social");
    });
});
