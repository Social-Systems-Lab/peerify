// Run: IS_BUILD=true bun test src/lib/data/map-visible-retired.test.ts
// "Show me on the map" (mapVisible) is retired for personal profiles (Tim, 2026-11-24). The switch
// was hidden in round h, but a stored true still put the person's hosted events on the map and kept
// their location in search results. Now, whatever the stored value:
// - events hosted by a personal profile never reach the map or the events list across circles
//   (getOpenEventsForMap, getOpenEventsForList);
// - a personal profile's search result never carries its location, for any viewer.
// The stored values are left alone. The database is in-memory fakes and the fake aggregate has no
// pipeline engine, so the event half runs each query's host-circle $match on sample host circles.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { matchesFilter } from "@/lib/testing/fake-collection";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));

// Record every Events pipeline the queries build.
const pipelines: any[][] = [];
const eventsCollection = (fakeDb.module as any).Events;
const fakeAggregate = eventsCollection.aggregate;
eventsCollection.aggregate = (pipeline: any[] = []) => {
    pipelines.push(pipeline);
    return fakeAggregate(pipeline);
};

const { searchDiscoverableCircles } = await import("./search");
const { getOpenEventsForMap, getOpenEventsForList } = await import("./event");

const OWNER = "did:test:canary-owner";
const CONNECTION = "did:test:connection";
const SUPERADMIN = "did:test:superadmin";
const STRANGER = "did:test:stranger";
const LOCATION = { city: "Canaryville", country: "ZA", precision: 2, lngLat: { lng: 18.4, lat: -33.9 } };

const person = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: did.split(":").pop(),
    circleType: "user",
    publishStatus: "published",
    ...extra,
});

beforeEach(() => {
    sessionDid = undefined;
    pipelines.length = 0;
    fakeDb.reset({
        Circles: [
            person(OWNER, {
                handle: "canary-on",
                name: "Canary On",
                searchable: true,
                mapVisible: true,
                location: LOCATION,
            }),
            person("did:test:canary-off", {
                handle: "canary-off",
                name: "Canary Off",
                searchable: true,
                mapVisible: false,
                location: LOCATION,
            }),
            {
                _id: new ObjectId(),
                did: "did:test:band",
                handle: "canary-band",
                name: "Canary Band",
                circleType: "circle",
                publishStatus: "published",
                location: LOCATION,
                metadata: { peerify: { managedIdentity: true, identityType: "band" } },
            },
            person(CONNECTION),
            person(SUPERADMIN, { isAdmin: true }),
            person(STRANGER),
        ],
        UserRelationships: [
            { _id: new ObjectId(), fromDid: CONNECTION, toDid: OWNER, connectStatus: "accepted" },
            { _id: new ObjectId(), fromDid: CONNECTION, toDid: "did:test:canary-off", connectStatus: "accepted" },
        ],
        Events: [],
    });
    fakeDb.setAggregateResult("Events", []);
});

describe("search: a personal profile's result never carries its location", () => {
    for (const [who, did] of [
        ["the owner", OWNER],
        ["an accepted connection", CONNECTION],
        ["a superadmin", SUPERADMIN],
    ] as const) {
        test(`${who}: no location, with the stored switch on or off`, async () => {
            const results = await searchDiscoverableCircles({ query: "canary", viewerDid: did });
            for (const handle of ["canary-on", "canary-off"]) {
                const entry: any = results.find((c) => c.handle === handle);
                if (!entry) continue; // the owner is only connected to themselves
                expect(entry.location).toBeUndefined();
                expect(JSON.stringify(entry)).not.toContain("Canaryville");
            }
            expect(results.some((c) => c.handle === "canary-on")).toBe(true);
        });
    }

    test("a band keeps its location", async () => {
        const results = await searchDiscoverableCircles({ query: "canary", viewerDid: STRANGER });
        expect((results.find((c) => c.handle === "canary-band") as any)?.location?.city).toBe("Canaryville");
    });
});

// The host-circle $match: the stage that gates on circleDetails.publishStatus.
const hostGate = (pipeline: any[]) =>
    pipeline.find((stage) => stage.$match && JSON.stringify(stage.$match).includes("circleDetails.publishStatus"))
        ?.$match;
const host = (extra: Record<string, unknown>) => ({
    circleDetails: { _id: "h", name: "Host", handle: "host", publishStatus: "published", ...extra },
});

describe("events hosted by a personal profile never reach the map or the list", () => {
    for (const [name, run] of [
        ["getOpenEventsForMap", () => getOpenEventsForMap(STRANGER)],
        ["getOpenEventsForList", () => getOpenEventsForList(STRANGER)],
    ] as const) {
        test(`${name}: a personal host is excluded, with the stored switch on, off or missing`, async () => {
            await run();
            const gate = hostGate(pipelines.at(-1) ?? []);
            expect(gate).not.toBeUndefined();
            expect(matchesFilter(host({ circleType: "user", mapVisible: true }), gate)).toBe(false);
            expect(matchesFilter(host({ circleType: "user", mapVisible: false }), gate)).toBe(false);
            expect(matchesFilter(host({ circleType: "user" }), gate)).toBe(false);
        });

        test(`${name}: a published band or venue host still passes, an unpublished one doesn't`, async () => {
            await run();
            const gate = hostGate(pipelines.at(-1) ?? []);
            expect(matchesFilter(host({ circleType: "circle" }), gate)).toBe(true);
            expect(matchesFilter(host({ circleType: "circle", publishStatus: undefined }), gate)).toBe(true);
            expect(matchesFilter(host({ circleType: "circle", publishStatus: "draft" }), gate)).toBe(false);
        });

        test(`${name}: the host-circle lookup and gate no longer read mapVisible`, async () => {
            await run();
            const pipeline = pipelines.at(-1) ?? [];
            const hostLookup = pipeline.find((stage) => stage.$lookup?.as === "circleDetails");
            expect(hostLookup).not.toBeUndefined();
            expect(JSON.stringify(hostLookup)).not.toContain("mapVisible");
            expect(JSON.stringify(hostGate(pipeline))).not.toContain("mapVisible");
        });
    }
});
