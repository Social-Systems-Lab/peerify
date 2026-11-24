// Run: IS_BUILD=true bun test src/lib/data/followers-no-distance.test.tsx
// Followers lists show no distance, for everyone (Tim, 2026-11-24): the rows carry no distance or
// proximity (proximity is the distance on a 0–1 scale), "near" sorts like Top, and the list's
// filter has no Near tab. Other lists keep their Near tab. The database is in-memory fakes.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ObjectId } from "mongodb";
import { createStore, Provider } from "jotai";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
    usePathname: () => "/circles/band/followers",
    useSearchParams: () => new URLSearchParams(),
}));

const { getMembersWithMetrics } = await import("./member");
const { ListFilter } = await import("@/components/utils/list-filter");
const { default: MemberTable } = await import("@/components/modules/members/members-table");

const CIRCLE_ID = "650000000000000000000081";
const SUPERADMIN = "did:test:superadmin";
const NEAR = "did:test:near";
const FAR = "did:test:far";

const CAPE_TOWN = { lng: 18.42, lat: -33.92 };
const person = (did: string, lngLat: { lng: number; lat: number }, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: did.split(":").pop(),
    circleType: "user",
    location: { city: "Somewhere", country: "ZA", precision: 2, lngLat },
    ...extra,
});
const people: Record<string, ReturnType<typeof person>> = {
    [SUPERADMIN]: person(SUPERADMIN, CAPE_TOWN, { isAdmin: true }),
    // Near the viewer but followed long ago; far away but followed today, with more followers.
    [NEAR]: person(NEAR, { lng: 18.43, lat: -33.93 }, { members: 0 }),
    [FAR]: person(FAR, { lng: -74.0, lat: 40.7 }, { members: 50 }),
};
const rows = [
    {
        _id: new ObjectId(),
        userDid: NEAR,
        circleId: CIRCLE_ID,
        userGroups: ["members"],
        joinedAt: new Date("2025-01-01"),
    },
    { _id: new ObjectId(), userDid: FAR, circleId: CIRCLE_ID, userGroups: ["members"], joinedAt: new Date() },
];

beforeEach(() => {
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(CIRCLE_ID), did: "did:test:band", handle: "band", circleType: "circle" },
            ...Object.values(people),
        ],
        Members: rows,
        UserRelationships: [],
    });
    fakeDb.setAggregateResult(
        "Members",
        rows.map((row) => {
            const who = people[row.userDid];
            return {
                ...row,
                _id: String(row._id),
                name: who.name,
                handle: who.handle,
                did: who.did,
                circleType: who.circleType,
                location: who.location,
                members: (who as any).members,
                createdAt: row.joinedAt,
            };
        }),
    );
});

describe("the rows", () => {
    test("no distance or proximity, even for a superadmin who gets full rows", async () => {
        for (const sort of [undefined, "top", "near", "new"] as const) {
            const result = await getMembersWithMetrics(SUPERADMIN, CIRCLE_ID, sort as any);
            expect(result.length).toBe(2);
            for (const row of result) {
                expect(row.metrics?.distance).toBeUndefined();
                expect(row.metrics?.proximity).toBeUndefined();
            }
            expect(JSON.stringify(result)).not.toContain('"distance"');
        }
    });

    test('"near" sorts like Top', async () => {
        const order = async (sort?: string) =>
            (await getMembersWithMetrics(SUPERADMIN, CIRCLE_ID, sort as any)).map((row) => row.userDid);
        expect(await order("near")).toEqual(await order("top"));
    });
});

describe("the filter tabs", () => {
    test("the shared filter still has Near by default (feeds, events, circle lists)", () => {
        expect(renderToStaticMarkup(<ListFilter showSdgFilter={false} />)).toContain("Near");
    });

    test("it can leave Near out", () => {
        const html = renderToStaticMarkup(<ListFilter showSdgFilter={false} showNear={false} />);
        expect(html).not.toContain("Near");
        expect(html).toContain("Top");
    });

    test("the followers list has no Near tab and no distance badge", async () => {
        const members = await getMembersWithMetrics(SUPERADMIN, CIRCLE_ID);
        // As the rows looked before, with a distance, so the table itself is checked too.
        const withDistance = members.map((member) => ({ ...member, metrics: { ...member.metrics, distance: 4.2 } }));
        const html = renderToStaticMarkup(
            <Provider store={createStore()}>
                <MemberTable
                    circle={{ _id: CIRCLE_ID, handle: "band", circleType: "circle" } as any}
                    members={withDistance as any}
                />
            </Provider>,
        );
        expect(html).toContain("Top");
        expect(html).not.toContain("Near");
        expect(html).not.toContain("4.2 km");
    });
});

describe("Top leaves proximity out (2026-11-24)", () => {
    // Two followers alike in everything but where they are; the far one is listed first.
    const twin = (did: string, lngLat: { lng: number; lat: number }) =>
        person(did, lngLat, { members: 5, createdAt: new Date("2026-06-01") });
    const FAR_TWIN = "did:test:far-twin";
    const NEAR_TWIN = "did:test:near-twin";
    const twins: Record<string, ReturnType<typeof twin>> = {
        [FAR_TWIN]: twin(FAR_TWIN, { lng: -74.0, lat: 40.7 }),
        [NEAR_TWIN]: twin(NEAR_TWIN, { lng: 18.43, lat: -33.93 }),
    };
    const twinRows = [FAR_TWIN, NEAR_TWIN].map((userDid) => ({
        _id: new ObjectId(),
        userDid,
        circleId: CIRCLE_ID,
        userGroups: ["members"],
        joinedAt: new Date("2026-06-01"),
    }));
    const setUp = (viewerLocation: unknown) => {
        fakeDb.reset({
            Circles: [
                { _id: new ObjectId(CIRCLE_ID), did: "did:test:band", handle: "band", circleType: "circle" },
                { ...people[SUPERADMIN], location: viewerLocation },
                ...Object.values(twins),
            ],
            Members: twinRows,
            UserRelationships: [],
        });
        fakeDb.setAggregateResult(
            "Members",
            twinRows.map((row) => {
                const who = twins[row.userDid];
                return {
                    ...row,
                    _id: String(row._id),
                    name: who.name,
                    handle: who.handle,
                    did: who.did,
                    circleType: who.circleType,
                    location: who.location,
                    members: (who as any).members,
                    createdAt: (who as any).createdAt,
                };
            }),
        );
    };
    const order = async (sort?: string) =>
        (await getMembersWithMetrics(SUPERADMIN, CIRCLE_ID, sort as any)).map((row) => row.userDid);

    test("the viewer's location doesn't change the Top order", async () => {
        for (const sort of [undefined, "top", "near"]) {
            setUp(undefined);
            const withoutLocation = await order(sort);
            setUp({ precision: 2, city: "Cape Town", lngLat: CAPE_TOWN });
            expect(await order(sort)).toEqual(withoutLocation);
        }
    });
});
