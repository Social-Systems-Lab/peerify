// Run: IS_BUILD=true bun test "src/app/circles/[handle]/settings/spaces/space-photos-actions.test.ts"
// Private space photos in the spaces actions: the session and the private bucket are mocked, the
// database is the in-memory fake (testing/fake-db.ts). Nothing is uploaded.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const ALICE = "did:test:alice";
let viewerDid = ALICE;
let savedType = "image/jpeg";
let counter = 0;
const objects = new Set<string>();
const removed: string[] = [];

// The rest of auth.ts is imported by the data layer; only the session is replaced.
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => viewerDid }));
mock.module("@/lib/data/storage", () => ({
    isFile: (value: unknown) => Boolean((value as { __testFile?: boolean } | undefined)?.__testFile),
    savePrivateFile: async (_file: unknown, folder: string) => {
        counter += 1;
        const key = `${folder}/${counter.toString(16).padStart(32, "0")}.jpg`;
        objects.add(key);
        return { key, originalName: `photo${counter}.jpg`, contentType: savedType, size: 3 };
    },
    removePrivateObject: async (key: string) => {
        removed.push(key);
        objects.delete(key);
    },
    listObjectKeysByPrefix: async (_bucket: string, prefix: string) => [...objects].filter((key) => key.startsWith(prefix)),
    removeObjectKeys: async (_bucket: string, keys: string[]) => {
        for (const key of keys) {
            removed.push(key);
            objects.delete(key);
        }
        return keys.length;
    },
}));

const { createSpaceAction, deleteSpaceAction, updateSpaceAction } = await import("./actions");

const input = (photos: unknown[]) => ({
    type: "private",
    location: { precision: 2, city: "Lund", country: "Sweden", lngLat: { lng: 13.19, lat: 55.7 } },
    capacity: 20,
    setting: ["indoor"],
    amplification: "acoustic_only",
    stepFreeAccess: "stairs_involved",
    dealPreferences: ["none"],
    listeningRuleAccepted: true,
    hostResponsibilityAccepted: true,
    photos,
});
const file = { file: { __testFile: true } };
const spaceDoc = () => fakeDb.col("Spaces").docs[0];

beforeEach(() => {
    fakeDb.reset({ Circles: [{ _id: new ObjectId(), did: ALICE, circleType: "user", isVerified: true }] });
    viewerDid = ALICE;
    savedType = "image/jpeg";
    objects.clear();
    removed.length = 0;
});

describe("space photos in the spaces actions", () => {
    test("new photos are saved in the space's own folder and stored as addresses", async () => {
        const result = await createSpaceAction(input([file, file]));
        expect(result.success).toBe(true);
        const id = String(spaceDoc()._id);
        expect(spaceDoc().photos.map((p: { url: string }) => p.url.startsWith(`/api/space-photo/${id}/`))).toEqual([true, true]);
        expect([...objects].every((key) => key.startsWith(`space-photos/${id}/`))).toBe(true);
    });

    test("more than 5 photos are refused, and nothing uploaded stays", async () => {
        const result = await createSpaceAction(input([file, file, file, file, file, file]));
        expect(result.success).toBe(false);
        expect(fakeDb.col("Spaces").docs).toHaveLength(0);
        expect(objects.size).toBe(0);
    });

    test("an upload that isn't a plain image is removed and dropped", async () => {
        savedType = "image/svg+xml";
        await createSpaceAction(input([file]));
        expect(objects.size).toBe(0);
        expect("photos" in spaceDoc()).toBe(false);
    });

    test("edit: kept photos stay, removed ones are deleted, another space's address is ignored", async () => {
        await createSpaceAction(input([file, file]));
        const id = String(spaceDoc()._id);
        const [first, second] = spaceDoc().photos;
        const foreign = { existingMediaUrl: `/api/space-photo/${String(new ObjectId())}/${"a".repeat(32)}.jpg` };
        const result = await updateSpaceAction(id, input([{ existingMediaUrl: first.url }, foreign, file]));
        expect(result.success).toBe(true);
        const urls = spaceDoc().photos.map((p: { url: string }) => p.url);
        expect(urls).toHaveLength(2);
        expect(urls[0]).toBe(first.url);
        expect(urls.includes(second.url)).toBe(false);
        expect(removed).toEqual([`space-photos/${id}/${second.fileName}`]);
    });

    test("someone else's space: refused before any upload", async () => {
        await createSpaceAction(input([file]));
        const id = String(spaceDoc()._id);
        const before = objects.size;
        viewerDid = "did:test:mallory";
        fakeDb.col("Circles").docs.push({ _id: new ObjectId(), did: viewerDid, circleType: "user", isVerified: true });
        expect((await updateSpaceAction(id, input([file]))).success).toBe(false);
        expect(objects.size).toBe(before);
    });

    test("deleting the space removes its photo folder", async () => {
        await createSpaceAction(input([file, file]));
        const id = String(spaceDoc()._id);
        expect((await deleteSpaceAction(id)).success).toBe(true);
        expect([...objects].filter((key) => key.startsWith(`space-photos/${id}/`))).toEqual([]);
    });
});
