// Run: IS_BUILD=true bun test src/lib/data/personal-profile-access.test.ts
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const { canViewFullPersonalProfile, getFullProfileOwnerDids } = await import("./personal-profile-access");

const A = "did:test:a";
const B = "did:test:b";
const C = "did:test:c";
const VIEWER = "did:test:viewer";
const SUPERADMIN = "did:test:superadmin";
const edge = (fromDid: string, toDid: string, connectStatus: string) => ({
    _id: new ObjectId(),
    fromDid,
    toDid,
    connectStatus,
});

beforeEach(() =>
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(), did: VIEWER, circleType: "user" },
            { _id: new ObjectId(), did: SUPERADMIN, circleType: "user", isAdmin: true },
        ],
        UserRelationships: [
            edge(VIEWER, A, "accepted"),
            edge(VIEWER, B, "pending"),
            edge(C, VIEWER, "accepted"), // only the viewer's own edge counts
        ],
    }),
);

describe("canViewFullPersonalProfile", () => {
    const personal = (did: string) => ({ circleType: "user" as const, did });

    test("owner, accepted connection and superadmin: full", async () => {
        expect(await canViewFullPersonalProfile(personal(VIEWER), VIEWER)).toBe(true);
        expect(await canViewFullPersonalProfile(personal(A), VIEWER)).toBe(true);
        expect(await canViewFullPersonalProfile(personal(B), SUPERADMIN)).toBe(true);
    });

    test("signed out, a pending request, no relationship: limited", async () => {
        expect(await canViewFullPersonalProfile(personal(A), undefined)).toBe(false);
        expect(await canViewFullPersonalProfile(personal(B), VIEWER)).toBe(false);
        expect(await canViewFullPersonalProfile(personal(C), VIEWER)).toBe(false);
    });

    test("circles that aren't personal profiles are always full", async () => {
        expect(await canViewFullPersonalProfile({ circleType: "circle", did: B }, undefined)).toBe(true);
    });
});

describe("getFullProfileOwnerDids", () => {
    test("the viewer themselves and their accepted connections", async () => {
        expect(await getFullProfileOwnerDids(VIEWER, [A, B, C, VIEWER, A])).toEqual(new Set([VIEWER, A]));
    });
    test("a superadmin: all of them", async () => {
        expect(await getFullProfileOwnerDids(SUPERADMIN, [A, B, C])).toEqual(new Set([A, B, C]));
    });
    test("signed out or nobody asked about: none", async () => {
        expect(await getFullProfileOwnerDids(undefined, [A])).toEqual(new Set());
        expect(await getFullProfileOwnerDids(VIEWER, [])).toEqual(new Set());
    });
});
