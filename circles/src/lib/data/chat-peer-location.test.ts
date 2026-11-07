// Run: IS_BUILD=true bun test src/lib/data/chat-peer-location.test.ts
// Leak round 3, M6 (2026-11-07): getUserPrivate (what checkAuth sends the signed-in user's browser)
// lists the user's legacy chat rooms, each with the room's circle. For a direct chat that circle is
// the OTHER person's profile, and the projection included its location: their exact home. The chat
// pages never use it, so it's dropped.
// The fake database has no pipeline engine, so this test reads the projection getUserPrivate asks
// MongoDB for, and checks it with a minimal evaluation of that projection on a sample peer.

import { describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
const pipelines: any[][] = [];
const dbModule = {
    ...fakeDb.module,
    ChatRoomMembers: {
        ...(fakeDb.module as any).ChatRoomMembers,
        aggregate: (pipeline: any[]) => {
            pipelines.push(pipeline);
            return { toArray: async () => [] };
        },
    },
};
mock.module("@/lib/data/db", () => dbModule);
mock.module("@/lib/actions/notificationSettings", () => ({ getGroupedUserNotificationSettings: async () => ({}) }));

const { getUserPrivate } = await import("./user");

const ME = "did:test:me";
const PEER_STREET = "Canary Home Street 7";

// The fields getUserPrivate projects for a chat room's circle, evaluated on one peer document.
const projectRoomCircle = (pipeline: any[], peer: Record<string, unknown>) => {
    const project = [...pipeline].reverse().find((stage) => stage.$project)?.$project;
    const spec = project?.chatRoom?.circle?.$cond?.then as Record<string, unknown>;
    return Object.fromEntries(
        Object.entries(spec).map(([key, expr]) => [
            key,
            typeof expr === "string" && expr.startsWith("$circle.") ? peer[expr.slice("$circle.".length)] : "(computed)",
        ]),
    );
};

describe("getUserPrivate: chat room peers", () => {
    test("a direct chat's peer comes without a location", async () => {
        fakeDb.reset({ Circles: [{ _id: new ObjectId(), did: ME, handle: "me", name: "Me", circleType: "user" }] });
        await getUserPrivate(ME);

        expect(pipelines).toHaveLength(1);
        const peer = projectRoomCircle(pipelines[0], {
            _id: "peer-id",
            name: "Peer",
            handle: "peer",
            did: "did:test:peer",
            picture: { url: "/p.jpg" },
            location: { precision: 4, street: PEER_STREET, lngLat: { lng: 18.06, lat: 59.33 } },
            circleType: "user",
        });
        expect(Object.keys(peer)).not.toContain("location");
        expect(JSON.stringify(peer)).not.toContain(PEER_STREET);
        // What the chat pages use is still there.
        expect(peer.name).toBe("Peer");
        expect(peer.handle).toBe("peer");
        expect(peer.circleType).toBe("user");
    });
});
