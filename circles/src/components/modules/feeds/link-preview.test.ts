// Run: IS_BUILD=true bun test src/components/modules/feeds/link-preview.test.ts
// Round 3, item 2 (2026-10-20): the composer's internal link preview (getInternalLinkPreviewData)
// goes through the same viewer gate and field allow-list as previews embedded in feed posts. In-memory
// fakes (testing/fake-db.ts), session and permissions stubbed. The leak tests fail on the code
// before this change: it returned the raw circle (location, private fields) and served items of any
// circle through a URL naming a circle the viewer can see.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const HOST_ID = "64c000000000000000000001";
const OTHER_ID = "64c000000000000000000002";
const DRAFT_ID = "64c000000000000000000003";
const PROPOSAL_ID = "64c0000000000000000000a1";
const VIEWER = "did:test:viewer";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    // The viewer may see everything in HOST and nothing in OTHER or DRAFT.
    isAuthorized: async (did: string | undefined, circleId: string) => !!did && String(circleId) === HOST_ID,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getInternalLinkPreviewData } = await import("./actions");

const STREET = "Privatgatan 3";
const EMAIL = "owner@example.test";
const circle = (id: string, handle: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(id),
    did: `did:test:${handle}`,
    handle,
    name: handle.toUpperCase(),
    circleType: "circle",
    picture: { url: `https://img.test/${handle}.png` },
    location: { precision: 4, city: "Lund", street: STREET, lngLat: { lng: 13.19, lat: 55.7 } },
    metadata: { peerify: { venueProfile: { contactEmail: EMAIL } } },
    ...extra,
});
const leaks = (output: unknown) => {
    const text = JSON.stringify(output) ?? "";
    return text.includes(STREET) || text.includes(EMAIL) || text.includes("13.19");
};

beforeEach(() => {
    sessionDid = VIEWER;
    fakeDb.reset({
        Circles: [
            circle(HOST_ID, "host"),
            circle(OTHER_ID, "other"),
            circle(DRAFT_ID, "draft", { publishStatus: "draft" }),
        ],
        Proposals: [{ _id: new ObjectId(PROPOSAL_ID), circleId: OTHER_ID, name: "Secret plan", stage: "voting" }],
    });
    // The old code read proposals through an aggregate; give it the same document.
    fakeDb.setAggregateResult("Proposals", [
        { _id: PROPOSAL_ID, circleId: OTHER_ID, name: "Secret plan", stage: "voting", circle: circle(OTHER_ID, "other") },
    ]);
});

describe("getInternalLinkPreviewData", () => {
    test("a circle preview has identity fields only: no street, coordinates or contact details", async () => {
        const result = await getInternalLinkPreviewData("/circles/host");
        expect("data" in result && !!result.data).toBe(true);
        expect(leaks(result)).toBe(false);
        expect("data" in result && (result.data as { name?: string }).name).toBe("HOST");
    });

    test("an unpublished circle the viewer isn't part of gets no preview", async () => {
        const result = await getInternalLinkPreviewData("/circles/draft");
        expect("error" in result).toBe(true);
    });

    test("an item of another circle isn't served through a URL naming a circle the viewer can see", async () => {
        const result = await getInternalLinkPreviewData(`/circles/host/proposals/${PROPOSAL_ID}`);
        expect("error" in result).toBe(true);
        expect(JSON.stringify(result)).not.toContain("Secret plan");
    });

    test("logged out: no preview", async () => {
        sessionDid = undefined;
        expect(await getInternalLinkPreviewData("/circles/host")).toEqual({ error: "Unauthorized" });
    });
});
