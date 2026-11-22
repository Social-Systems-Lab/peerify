// Run: IS_BUILD=true bun test src/lib/data/map-personal-profiles.test.ts
// Explore map change A (2026-11-02): getSwipeCircles never returns a non-artist personal profile,
// and platform admins get the same rule. Since 2026-11-22 (Tim) no personal profile reaches the
// map at all, artist-marked ones with mapVisible included: their pages are limited for strangers,
// and artists who want a public page use an artist circle. Artist circles and venues stay.
// Uses the in-memory fakes (testing/fake-db.ts), so nothing real is touched.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const { getSwipeCircles } = await import("./circle");

const ADMIN = "did:test:admin";
const STRANGER = "did:test:stranger";
const location = { precision: 2, city: "Stockholm", country: "Sweden", lngLat: { lng: 18.07, lat: 59.33 } };

const person = (id: string, extra: Record<string, unknown> = {}) => ({
    _id: id,
    did: `did:test:${id}`,
    handle: id,
    name: id,
    circleType: "user",
    location,
    ...extra,
});

const handles = (circles: { handle?: string }[]) => circles.map((c) => c.handle).sort();

describe("getSwipeCircles: personal profiles on the Explore map", () => {
    beforeEach(() => {
        fakeDb.reset({
            Circles: [
                person("fan-visible", { mapVisible: true }),
                person("fan-hidden"),
                person("artist-intent-visible", { mapVisible: true, metadata: { peerify: { intent: "artist" } } }),
                person("artist-intent-hidden", { metadata: { peerify: { intent: "artist" } } }),
                person("admin", { did: ADMIN, isAdmin: true, mapVisible: true }),
                person("stranger", { did: STRANGER }),
                {
                    _id: "band",
                    did: "did:test:band",
                    handle: "band",
                    name: "Band",
                    circleType: "circle",
                    location,
                    metadata: { peerify: { managedIdentity: true, identityType: "band" } },
                },
                {
                    _id: "venue",
                    did: "did:test:venue",
                    handle: "venue",
                    name: "Venue",
                    circleType: "circle",
                    location,
                    metadata: { peerify: { managedIdentity: true, identityType: "venue" } },
                },
            ],
        });
    });

    test("anonymous: no personal profiles, artist-marked ones included; artist circles and venues stay", async () => {
        expect(handles(await getSwipeCircles())).toEqual(["band", "venue"]);
    });

    test("signed-in stranger: the same", async () => {
        expect(handles(await getSwipeCircles(STRANGER))).toEqual(["band", "venue"]);
    });

    test("platform admin: the same rule, no personal-profile bypass", async () => {
        expect(handles(await getSwipeCircles(ADMIN))).toEqual(["band", "venue"]);
    });

    test("the payload carries nothing from an artist-marked personal profile", async () => {
        for (const viewer of [undefined, STRANGER, ADMIN]) {
            expect(JSON.stringify(await getSwipeCircles(viewer))).not.toContain("artist-intent");
        }
    });
});
