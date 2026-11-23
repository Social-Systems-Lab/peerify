// Run: IS_BUILD=true bun test src/lib/data/member-pickers-limited.test.ts
// The task and issue assign pickers (getMembersAction) and the About › Admins card
// (getAdminMembers), Tim 2026-11-23: a person the viewer has no relationship with is name, handle
// and picture URL only, plus the row's own fields (userDid, circleId, groups, joinedAt). The
// viewer themselves, their accepted connections and superadmins get the row as before. Checks what
// the server returns. The fake database doesn't run pipelines, so joined rows are given directly.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async () => true,
}));

const { getAdminMembers } = await import("./member");
const { getMembersAction: getTaskMembersAction } = await import("@/app/circles/[handle]/tasks/actions");
const { getMembersAction: getIssueMembersAction } = await import("@/app/circles/[handle]/issues/actions");

const CIRCLE_ID = "650000000000000000000091";
const ASSIGNER = "did:test:assigner";
const PERSON = "did:test:person";
const FRIEND = "did:test:friend";
const SUPERADMIN = "did:test:superadmin";

const circleDoc = (did: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: `Name of ${did.split(":").pop()}`,
    circleType: "user",
    ...extra,
});
// A joined row as getMembers / getAdminMembers project it.
const personRow = {
    _id: "650000000000000000000092",
    userDid: PERSON,
    circleId: CIRCLE_ID,
    userGroups: ["admins", "members"],
    joinedAt: new Date("2026-11-01T10:00:00Z"),
    name: "Name of person",
    handle: "person",
    did: PERSON,
    circleType: "user",
    picture: { url: "https://cdn.example/person.png", fileName: "CANARY-file.png" },
    images: [{ fileInfo: { url: "https://cdn.example/CANARY-cover.png" } }],
    location: { city: "CANARY City", country: "ZA" },
    description: "CANARY about the person",
    members: 4242,
    searchable: true,
    mapVisible: true,
};
const LIMITED_ROW = {
    _id: "650000000000000000000092",
    userDid: PERSON,
    circleId: CIRCLE_ID,
    userGroups: ["admins", "members"],
    joinedAt: new Date("2026-11-01T10:00:00Z"),
    circleType: "user",
    did: PERSON,
    handle: "person",
    name: "Name of person",
    picture: { url: "https://cdn.example/person.png" },
};

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            circleDoc(PERSON),
            circleDoc(ASSIGNER),
            circleDoc(FRIEND),
            circleDoc(SUPERADMIN, { isAdmin: true }),
            { _id: new ObjectId(CIRCLE_ID), did: "did:test:circle", circleType: "circle", handle: "the-circle" },
        ],
        UserRelationships: [{ _id: new ObjectId(), fromDid: FRIEND, toDid: PERSON, connectStatus: "accepted" }],
    });
    fakeDb.setAggregateResult("Members", [{ ...personRow }]);
});

const pickers = [
    ["task assign picker", (circleId: string) => getTaskMembersAction(circleId)],
    ["issue assign picker", (circleId: string) => getIssueMembersAction(circleId)],
    ["About › Admins card", (circleId: string) => getAdminMembers(circleId, sessionDid)],
] as const;

for (const [name, load] of pickers) {
    describe(name, () => {
        test("no relationship: name, handle and picture URL, plus the row's own fields", async () => {
            sessionDid = ASSIGNER;
            const rows: any = await load(CIRCLE_ID);
            expect(rows).toEqual([LIMITED_ROW]);
            const payload = JSON.stringify(rows);
            expect(payload).not.toContain("CANARY");
            expect(payload).not.toContain("4242");
        });

        for (const [who, did] of [
            ["the person themselves", PERSON],
            ["an accepted connection", FRIEND],
            ["a superadmin", SUPERADMIN],
        ] as const) {
            test(`${who}: the row as before`, async () => {
                sessionDid = did;
                const rows: any = await load(CIRCLE_ID);
                if (name !== "About › Admins card") expect(rows[0].description).toBe("CANARY about the person");
                expect(rows[0].picture.fileName).toBe("CANARY-file.png");
            });
        }
    });
}
