// Run: IS_BUILD=true bun test src/app/admin-spaces.test.tsx
// Platform admins' view of spaces: loadAdminSpacesPage (lib/spaces/spaces-admin.ts) and the
// /admin/spaces page rendered to HTML. The database is in-memory fakes (testing/fake-db.ts) and the
// session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
let sessionThrows = false;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => {
        if (sessionThrows) throw new Error("invalid token");
        return sessionDid;
    },
}));

class NotFound extends Error {}
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    notFound: () => {
        throw new NotFound("NEXT_NOT_FOUND");
    },
}));

const { loadAdminSpacesPage } = await import("@/lib/spaces/spaces-admin");
const { default: AdminSpacesPage } = await import("@/app/admin/spaces/page");
const { createSpaceForOwner } = await import("@/lib/data/space");
const { parseSpaceInput } = await import("@/lib/spaces/space-rules");

const ADMIN = "did:test:admin";
const ALICE = "did:test:alice";
const BOB = "did:test:bob";

const base = { capacity: 12, dealPreferences: ["fixed_fee"], listeningRuleAccepted: true, hostResponsibilityAccepted: true };
const ALICE_HOME = {
    ...base,
    type: "private",
    location: { precision: 4, city: "Lund", country: "Sweden", street: "Stora Södergatan 1", lngLat: { lng: 13.19321, lat: 55.70466 } },
    setting: ["indoor"],
    amplification: "acoustic_only",
    stepFreeAccess: "not_specified",
    notesForPeerify: "Piano in the room",
};
const BOB_CAFE = {
    ...base,
    type: "popup",
    name: "Bob's Café",
    location: { precision: 4, city: "Malmö", country: "Sweden", street: "Davidshallsgatan 3", lngLat: { lng: 13.0, lat: 55.6 } },
    showTimes: "Mondays",
    powerAvailable: true,
    paAvailable: true,
};

const add = async (did: string, raw: unknown) => {
    const parsed = parseSpaceInput(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    await createSpaceForOwner(did, parsed.value);
};

const renderPage = async (): Promise<string> => {
    try {
        return renderToStaticMarkup(await AdminSpacesPage());
    } catch (error) {
        if (error instanceof NotFound) return "404";
        throw error;
    }
};

beforeEach(async () => {
    fakeDb.reset({
        Circles: [
            { did: ADMIN, circleType: "user", handle: "admin", isAdmin: true },
            { did: ALICE, circleType: "user", handle: "alice", name: "Alice A", email: "alice@example.test", isVerified: true },
            { did: BOB, circleType: "user", handle: "bob", name: "Bob B", email: "bob@example.test", isVerified: true },
        ],
    });
    sessionDid = undefined;
    sessionThrows = false;
    await add(ALICE, ALICE_HOME);
    await add(BOB, BOB_CAFE);
});

describe("loadAdminSpacesPage", () => {
    test("not an admin: not_found, for owners, other people, signed-out and broken sessions", async () => {
        for (const did of [ALICE, BOB, undefined, "did:test:unknown"]) {
            sessionDid = did;
            expect(await loadAdminSpacesPage()).toEqual({ status: "not_found" });
        }
        sessionThrows = true;
        expect(await loadAdminSpacesPage()).toEqual({ status: "not_found" });
    });

    test("an admin gets every space with its owner's name, handle and email", async () => {
        sessionDid = ADMIN;
        const data = await loadAdminSpacesPage();
        if (data.status !== "ok") throw new Error("expected ok");
        expect(data.spaces).toHaveLength(2);
        const byOwner = Object.fromEntries(data.spaces.map((s) => [s.ownerDid, s]));
        expect(byOwner[ALICE].owner).toEqual({ name: "Alice A", handle: "alice", email: "alice@example.test" });
        expect(byOwner[BOB].owner).toEqual({ name: "Bob B", handle: "bob", email: "bob@example.test" });
        // Even an admin only ever sees the rounded area of a private space: nothing else is stored.
        expect(byOwner[ALICE].location).toEqual({ precision: 2, city: "Lund", country: "Sweden", lngLat: { lng: 13.2, lat: 55.7 } });
    });
});

describe("/admin/spaces page", () => {
    test("404 for anyone but a platform admin", async () => {
        sessionDid = ALICE;
        expect(await renderPage()).toBe("404");
        sessionDid = undefined;
        expect(await renderPage()).toBe("404");
    });

    test("an admin sees both spaces, owners and the private notes", async () => {
        sessionDid = ADMIN;
        const html = await renderPage();
        expect(html).toContain("Bob&#x27;s Café");
        expect(html).toContain("Davidshallsgatan 3");
        expect(html).toContain("Lund, Sweden");
        expect(html).toContain("alice@example.test");
        expect(html).toContain("@bob");
        expect(html).toContain("Piano in the room");
        expect(html).toContain("1 pop-up, 1 private");
        expect(html).not.toContain("Stora Södergatan");
    });
});
