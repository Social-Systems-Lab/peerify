// Run: IS_BUILD=true bun test src/components/layout/content-preview-message-row.test.tsx
// The profile preview panel (Tim, 2026-11-24): Message and the connection button sat in the
// bottom-left corner of the cover image, and the 124px avatar, which overlaps the cover's bottom
// edge in the middle, covered the button between them (Connect, Requested or Connected). They now
// sit in the column under the name, centred and wrapping, so the avatar can't cover them at any
// panel width. Mounts the real panel in jsdom with the server's answers stubbed: the full
// personal profile, and a relationship that allows a message and offers Connect.

import { describe, expect, mock, test } from "bun:test";
// @ts-ignore jsdom ships no type declarations (it comes in with isomorphic-dompurify)
import { JSDOM } from "jsdom";
import React from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://staging.test/explore",
    pretendToBeVisual: true,
});
const g = globalThis as any;
for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (!(key in g)) {
        try {
            g[key] = (dom.window as any)[key];
        } catch {
            // some window getters throw outside a document; not needed here
        }
    }
}
g.window = dom.window;
g.document = dom.window.document;
g.navigator = dom.window.navigator;
g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
g.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
g.matchMedia ??= () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
});
for (const key of ["ResizeObserver", "IntersectionObserver", "matchMedia"]) {
    (dom.window as any)[key] ??= g[key];
}
g.IS_REACT_ACT_ENVIRONMENT = true;

const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
    usePathname: () => "/explore",
    useSearchParams: () => new URLSearchParams(),
}));

const PERSON_DID = "did:test:person";
const person = {
    _id: "650000000000000000000091",
    did: PERSON_DID,
    handle: "person",
    name: "Person Name",
    circleType: "user",
    description: "About the person",
};
const realHomeActions = await import("@/components/modules/home/actions");
const realCrewActions = await import("@/components/modules/crew/actions");
mock.module("@/components/modules/home/actions", () => ({
    ...realHomeActions,
    getPersonalProfilePreviewAction: async () => ({ kind: "full", circle: person }),
    getProfileRelationshipStateAction: async () => ({
        dmAllowed: true,
        connectStatus: "none",
        messageVisibilityReason: "event_guest",
        connectLabelReason: "default",
    }),
    getViewerIsCircleAdminAction: async () => ({ isAdmin: false }),
}));
mock.module("@/components/modules/crew/actions", () => ({
    ...realCrewActions,
    getCrewMembershipStatusAction: async () => null,
}));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { createStore, Provider } = await import("jotai");
const { userAtom } = await import("@/lib/data/atoms");
const { CirclePreview } = await import("./content-preview");

const mountPreview = async () => {
    const store = createStore();
    store.set(userAtom, {
        _id: "650000000000000000000092",
        did: "did:test:viewer",
        handle: "viewer",
        isVerified: true,
    } as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(
            <Provider store={store}>
                <CirclePreview circle={{ ...person } as any} circleType="user" />
            </Provider>,
        );
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
    return { container, unmount: () => act(async () => root.unmount()) };
};

const buttonNamed = (container: HTMLElement, label: string) =>
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === label);

// Positioned over the cover (or anywhere): any ancestor with Tailwind's "absolute".
const isInsidePositionedBox = (element: Element) => {
    for (let node: Element | null = element.parentElement; node; node = node.parentElement) {
        if (node.classList.contains("absolute")) return true;
    }
    return false;
};

describe("Message and Connect in the full preview of a personal profile", () => {
    test("both are shown", async () => {
        const { container, unmount } = await mountPreview();
        expect(container.textContent).toContain("Person Name");
        expect(buttonNamed(container, "Message")).not.toBeUndefined();
        expect(buttonNamed(container, "Connect")).not.toBeUndefined();
        await unmount();
    });

    test("not positioned over the cover, where the avatar overlaps it", async () => {
        const { container, unmount } = await mountPreview();
        for (const label of ["Message", "Connect"]) {
            expect(isInsidePositionedBox(buttonNamed(container, label)!)).toBe(false);
        }
        await unmount();
    });

    test("under the name, in a centred row that wraps", async () => {
        const { container, unmount } = await mountPreview();
        const name = Array.from(container.querySelectorAll("div")).find(
            (div) => div.classList.contains("header") && div.textContent === "Person Name",
        )!;
        const message = buttonNamed(container, "Message")!;
        expect((name.compareDocumentPosition(message) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
        const row = message.closest("[data-preview-message-row]");
        expect(row).not.toBeNull();
        expect(row!.className).toContain("justify-center");
        expect(row!.className).toContain("flex-wrap");
        await unmount();
    });
});
