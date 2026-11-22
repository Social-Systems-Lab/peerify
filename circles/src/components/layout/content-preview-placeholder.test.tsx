// Run: IS_BUILD=true bun test src/components/layout/content-preview-placeholder.test.tsx
// The preview panel's limited version of a personal profile (Tim, 2026-11-22): name, @handle and
// picture only, never anything else from the object its opener held (follower count, Followers
// link, social links, SDGs, about text, distance). This first render is what shows until the
// server answers (getPersonalProfilePreviewAction, tested separately) and for everyone it limits.
// The search and map settings make no difference.

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
    getPersonalProfilePreviewAction: async () => ({ kind: "limited" }),
    getViewerIsCircleAdminAction: async () => ({ isAdmin: false }),
}));
mock.module("@/components/modules/crew/actions", () => ({
    ...realCrewActions,
    getCrewMembershipStatusAction: async () => null,
}));

const { CirclePreview } = await import("./content-preview");

// The opener's object carries everything a followers row or a list might hold.
const person = (searchable: boolean) =>
    ({
        _id: "650000000000000000000021",
        did: "did:test:person",
        handle: "real-handle",
        name: "Real Name",
        picture: { url: "https://cdn.example/real-face.png" },
        circleType: "user",
        searchable,
        mapVisible: searchable,
        members: 43,
        socialLinks: [{ platform: "instagram", url: "https://instagram.com/CANARY-social" }],
        causes: ["sdg-1"],
        description: "CANARY description",
        mission: "CANARY mission",
        metrics: { distance: 1.234 },
    }) as any;
const band = () =>
    ({
        _id: "650000000000000000000022",
        did: "did:test:band",
        handle: "band",
        name: "The Band",
        circleType: "circle",
        members: 13,
        socialLinks: [{ platform: "instagram", url: "https://instagram.com/the-band" }],
        description: "Public band text",
    }) as any;

describe("CirclePreview: a personal profile's limited version", () => {
    for (const searchable of [false, true]) {
        test(`name, @handle and picture only (searchable: ${searchable})`, () => {
            const html = renderToStaticMarkup(<CirclePreview circle={person(searchable)} circleType="user" />);
            expect(html).toContain("Real Name");
            expect(html).toContain("@real-handle");
            expect(html).toContain(encodeURIComponent("https://cdn.example/real-face.png"));
            expect(html).toContain("only visible to their connections");
            expect(html).not.toContain("CANARY");
            expect(html).not.toContain("Follower");
            expect(html).not.toContain("42");
            expect(html).not.toContain("SDGs");
            expect(html).not.toContain("1.2"); // no distance indicator
        });
    }
});

describe("CirclePreview: artist, band and venue circles are unchanged", () => {
    test("count, links and text as before", () => {
        const html = renderToStaticMarkup(<CirclePreview circle={band()} circleType="circle" />);
        expect(html).toContain("The Band");
        expect(html).toContain("13 Followers");
        expect(html).toContain("the-band");
        expect(html).toContain("Public band text");
    });
});
