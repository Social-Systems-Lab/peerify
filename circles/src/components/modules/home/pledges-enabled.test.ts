// Run: bun test src/components/modules/home/pledges-enabled.test.ts
// Session, permission check, circles and pledge storage are mocked; nothing is written.
// With Pledges turned off (pledgesEnabled: false), a direct call must not add a pledge; on or
// absent, it goes through as before.

import { beforeEach, describe, expect, mock, test } from "bun:test";

let pledgesEnabled: boolean | undefined;
const createCalls: unknown[] = [];

mock.module("@/lib/auth/auth", () => ({
    getAuthenticatedUserDid: async () => "did-fan",
    isAuthorized: async () => false,
}));
mock.module("@/lib/data/circle", () => ({
    getCircleById: async (id: string) => ({
        _id: id,
        handle: "band",
        circleType: "circle",
        metadata: { peerify: { managedIdentity: true, identityType: "band" } },
        ...(pledgesEnabled === undefined ? {} : { pledgesEnabled }),
    }),
    getCircleByDid: async (did: string) => ({ _id: "fan-circle", did }),
}));
mock.module("@/lib/data/peerify-pledges", () => ({
    createPeerifyPledge: async (input: unknown) => {
        createCalls.push(input);
        return { _id: "pledge-1" };
    },
    getPeerifyPledgeForFan: async () => null,
}));

const { createPeerifyPledgeAction } = await import("./peerify-pledge-actions");

const pledge = { fanLocation: "Uppsala", note: "Come play!" };

describe("createPeerifyPledgeAction and pledgesEnabled", () => {
    beforeEach(() => {
        pledgesEnabled = undefined;
        createCalls.length = 0;
    });

    test("Pledges off: refused, nothing stored", async () => {
        pledgesEnabled = false;
        const result = await createPeerifyPledgeAction({ artistCircleId: "band-circle", pledge });

        expect(result.success).toBe(false);
        expect(result.message).toContain("isn't taking pledges");
        expect(createCalls).toHaveLength(0);
    });

    test("Pledges on: stored", async () => {
        pledgesEnabled = true;
        const result = await createPeerifyPledgeAction({ artistCircleId: "band-circle", pledge });

        expect(result.success).toBe(true);
        expect(createCalls).toHaveLength(1);
    });

    test("never set (existing artists): on", async () => {
        const result = await createPeerifyPledgeAction({ artistCircleId: "band-circle", pledge });

        expect(result.success).toBe(true);
        expect(createCalls).toHaveLength(1);
    });
});
