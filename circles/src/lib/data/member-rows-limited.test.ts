// Run: IS_BUILD=true bun test src/lib/data/member-rows-limited.test.ts
// The follower list's rows (getMembersWithMetrics, what the Followers table receives), Tim
// 2026-11-22: a row whose person the viewer has no relationship with carries name, handle and
// picture only (plus the row's own who/which circle/groups/followed-at). The viewer's own row,
// their accepted connections' rows, and every row for a superadmin stay complete. Checks the
// returned rows themselves, which is what reaches the browser.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const { getMembersWithMetrics } = await import("./member");

const CIRCLE_ID = "650000000000000000000041";
const ADMIN = "did:test:admin";
const FAN = "did:test:fan";
const FRIEND = "did:test:friend";
const SUPERADMIN = "did:test:superadmin";

const person = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: `Name of ${did.split(":").pop()}`,
    picture: { url: `https://cdn.example/${did.split(":").pop()}.png`, fileName: "CANARY-file.png" },
    circleType: "user",
    description: `CANARY about ${did}`,
    images: [{ fileInfo: { url: "https://cdn.example/CANARY-cover.png" } }],
    location: { city: "CANARY City", country: "ZA", lngLat: { lng: 18.4, lat: -33.9 } },
    members: 4242,
    searchable: true,
    mapVisible: true,
    ...extra,
});
const row = (userDid: string, userGroups: string[]) => ({
    _id: new ObjectId(),
    userDid,
    circleId: CIRCLE_ID,
    userGroups,
    joinedAt: new Date("2026-11-01T10:00:00Z"),
});

// What getMembers' aggregate ($lookup of the person, then its $project) returns for a row: the
// fake database doesn't run pipelines, so the joined rows are given directly.
const joined = (member: ReturnType<typeof row>, who: ReturnType<typeof person>) => ({
    _id: String(member._id),
    userDid: member.userDid,
    circleId: member.circleId,
    userGroups: member.userGroups,
    joinedAt: member.joinedAt,
    name: who.name,
    picture: who.picture,
    images: who.images,
    location: who.location,
    description: who.description,
    members: who.members,
    circleType: who.circleType,
    handle: who.handle,
    did: who.did,
    searchable: who.searchable,
    mapVisible: who.mapVisible,
});

beforeEach(() => {
    const people: Record<string, ReturnType<typeof person>> = {
        [ADMIN]: person(ADMIN),
        [FAN]: person(FAN),
        [FRIEND]: person(FRIEND),
    };
    const members = [row(ADMIN, ["admins", "moderators", "members"]), row(FAN, ["members"]), row(FRIEND, ["members"])];
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(CIRCLE_ID), did: "did:test:band", handle: "band", circleType: "circle" },
            ...Object.values(people),
            person(SUPERADMIN, { isAdmin: true }),
        ],
        Members: members,
        UserRelationships: [{ _id: new ObjectId(), fromDid: ADMIN, toDid: FRIEND, connectStatus: "accepted" }],
    });
    fakeDb.setAggregateResult(
        "Members",
        members.map((member) => joined(member, people[member.userDid])),
    );
});

const rowOf = (rows: any[], did: string) => rows.find((r) => r.userDid === did);

describe("Followers rows, seen by the circle's admin", () => {
    test("a follower they have no relationship with: name, handle and picture only", async () => {
        const fan = rowOf(await getMembersWithMetrics(ADMIN, CIRCLE_ID), FAN);
        expect(Object.keys(fan).sort()).toEqual(
            [
                "_id",
                "circleId",
                "circleType",
                "did",
                "handle",
                "joinedAt",
                "name",
                "picture",
                "userDid",
                "userGroups",
            ].sort(),
        );
        expect(fan.name).toBe("Name of fan");
        expect(fan.handle).toBe("fan");
        expect(fan.picture).toEqual({ url: "https://cdn.example/fan.png" });
        expect(JSON.stringify(fan)).not.toContain("CANARY");
        expect(JSON.stringify(fan)).not.toContain("4242");
    });

    test("an accepted connection and their own row: complete", async () => {
        const rows = await getMembersWithMetrics(ADMIN, CIRCLE_ID);
        expect(rowOf(rows, FRIEND).description).toBe(`CANARY about ${FRIEND}`);
        expect(rowOf(rows, ADMIN).description).toBe(`CANARY about ${ADMIN}`);
    });

    test("the whole list's payload names nobody's private details but the connection's and the admin's", async () => {
        const payload = JSON.stringify(await getMembersWithMetrics(ADMIN, CIRCLE_ID));
        expect(payload).not.toContain(`CANARY about ${FAN}`);
    });
});

describe("Followers rows, other viewers", () => {
    test("a superadmin: every row complete", async () => {
        const rows = await getMembersWithMetrics(SUPERADMIN, CIRCLE_ID);
        expect(rowOf(rows, FAN).description).toBe(`CANARY about ${FAN}`);
    });

    test("signed out: every personal row limited", async () => {
        const rows = await getMembersWithMetrics(undefined, CIRCLE_ID);
        expect(JSON.stringify(rows)).not.toContain("CANARY");
        expect(rows.map((r: any) => r.name).sort()).toEqual(["Name of admin", "Name of fan", "Name of friend"]);
    });
});
