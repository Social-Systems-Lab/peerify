// Run: IS_BUILD=true bun test src/app/circles/circles-page.test.ts
// Round 3, item 5 (2026-10-20): the /circles page hands CirclesList (a client component) only the
// viewer's own circle fields it reads, not the getUserPrivate result with every membership's circle
// (location, metadata, access rules). Data functions and the client components are stubbed. The
// test fails on the code before this change, which passed the whole private user.

import { describe, expect, mock, test } from "bun:test";
import { isValidElement, type ReactElement } from "react";

const VIEWER = "did:test:viewer";
const STREET = "Medlemsgatan 4";

mock.module("@/lib/auth/auth", () => ({ getAuthenticatedUserDid: async () => VIEWER }));
mock.module("@/lib/data/user", () => ({
    getUserPrivate: async () => ({
        _id: "u1",
        did: VIEWER,
        handle: "viewer",
        name: "Viewer",
        circleType: "user",
        email: "viewer@example.test",
        accessRules: { communities: { create: ["admins"] } },
        enabledModules: ["home"],
        memberships: [
            {
                circleId: "c1",
                userGroups: ["members"],
                circle: {
                    _id: "c1",
                    handle: "venue",
                    circleType: "circle",
                    location: { precision: 4, street: STREET, lngLat: { lng: 18.01, lat: 59.3 } },
                    metadata: { peerify: { venueProfile: { contactEmail: "venue@example.test" } } },
                },
            },
        ],
    }),
}));
mock.module("@/lib/data/circle", () => ({
    getCirclesByIds: async () => [],
    getCirclesWithMetrics: async () => [],
    getMetricsForCircles: async () => [],
}));
mock.module("@/lib/peerify/artist-profile", () => ({ isPeerifyManagedIdentity: () => false }));
const CirclesList = () => null;
mock.module("@/components/modules/circles/circles-list", () => ({ default: CirclesList }));
mock.module("@/components/modules/circles/circles-tab", () => ({ default: () => null }));

const { default: CirclesPage } = await import("./page");

// Depth-first search of the returned element tree for the CirclesList element.
const findElement = (node: unknown, type: unknown): ReactElement<any> | undefined => {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findElement(child, type);
            if (found) return found;
        }
        return undefined;
    }
    if (!isValidElement(node)) return undefined;
    if (node.type === type) return node as ReactElement<any>;
    return findElement((node.props as any)?.children, type);
};

describe("/circles page", () => {
    test("CirclesList gets the viewer's own circle fields only, no memberships or private fields", async () => {
        const tree = await CirclesPage({ params: Promise.resolve({ handle: "" }), searchParams: Promise.resolve({}) });
        const list = findElement(tree, CirclesList);
        expect(list).not.toBeUndefined();
        const circle = list!.props.circle;
        expect(circle.did).toBe(VIEWER);
        expect(circle.accessRules).toEqual({ communities: { create: ["admins"] } });
        const text = JSON.stringify(circle);
        expect(text.includes(STREET) || text.includes("memberships") || text.includes("@example.test")).toBe(false);
    });
});
