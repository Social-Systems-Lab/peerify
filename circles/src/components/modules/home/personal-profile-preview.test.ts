// Run: IS_BUILD=true bun test src/components/modules/home/personal-profile-preview.test.ts
// The preview panel's data for a personal profile (Tim, 2026-11-22): the same rule as the page.
// Owner, superadmins and accepted connections get the full profile; everyone else, including a
// follower and a signed-in stranger, gets name, handle and picture only. Checks the returned
// payload itself, which is what reaches the browser.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getPersonalProfilePreviewAction } = await import("./actions");

const OWNER = "did:test:owner";
const STRANGER = "did:test:stranger";
const FOLLOWER = "did:test:follower";
const CONNECTION = "did:test:connection";
const SUPERADMIN = "did:test:superadmin";
const PROFILE_ID = "650000000000000000000031";

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(PROFILE_ID),
                did: OWNER,
                handle: "owner",
                name: "Owner Name",
                picture: { url: "https://cdn.example/owner.png" },
                circleType: "user",
                publishStatus: "published",
                searchable: true,
                mapVisible: true,
                description: "CANARY description",
                members: 4242,
                socialLinks: [{ platform: "x", url: "https://x.com/CANARY" }],
                location: { city: "CANARY City" },
            },
            { _id: new ObjectId(), did: STRANGER, circleType: "user", handle: "stranger" },
            { _id: new ObjectId(), did: FOLLOWER, circleType: "user", handle: "follower" },
            { _id: new ObjectId(), did: CONNECTION, circleType: "user", handle: "connection" },
            { _id: new ObjectId(), did: SUPERADMIN, circleType: "user", handle: "super", isAdmin: true },
            {
                _id: new ObjectId(),
                did: "did:test:band",
                circleType: "circle",
                handle: "band",
                description: "public band text",
            },
        ],
        Members: [{ userDid: FOLLOWER, circleId: PROFILE_ID, userGroups: ["members"] }],
        UserRelationships: [{ _id: new ObjectId(), fromDid: CONNECTION, toDid: OWNER, connectStatus: "accepted" }],
    });
});

const LIMITED = {
    kind: "limited",
    profile: { handle: "owner", name: "Owner Name", pictureUrl: "https://cdn.example/owner.png" },
};

describe("getPersonalProfilePreviewAction", () => {
    for (const [who, did] of [
        ["signed out", undefined],
        ["a signed-in stranger", STRANGER],
        ["a follower", FOLLOWER],
    ] as const) {
        test(`${who}: name, handle and picture only`, async () => {
            sessionDid = did;
            const result = await getPersonalProfilePreviewAction(OWNER);
            expect(result).toEqual(LIMITED as any);
            const payload = JSON.stringify(result);
            expect(payload).not.toContain("CANARY");
            expect(payload).not.toContain("4242");
            expect(payload).not.toContain(OWNER);
        });
    }

    for (const [who, did] of [
        ["the owner", OWNER],
        ["an accepted connection", CONNECTION],
        ["a superadmin", SUPERADMIN],
    ] as const) {
        test(`${who}: the full profile`, async () => {
            sessionDid = did;
            const result = await getPersonalProfilePreviewAction(OWNER);
            expect(result.kind).toBe("full");
            expect(JSON.stringify(result)).toContain("CANARY description");
        });
    }

    test("an artist, band or venue circle: not personal, the panel carries on as before", async () => {
        expect(await getPersonalProfilePreviewAction("did:test:band")).toEqual({ kind: "not_personal" });
    });

    test("an unknown did: not found", async () => {
        expect(await getPersonalProfilePreviewAction("did:test:nobody")).toEqual({ kind: "not_found" });
    });
});
