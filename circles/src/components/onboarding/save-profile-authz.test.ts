// Run: bun test src/components/onboarding/save-profile-authz.test.ts
// Session, permission check, circle/user data and storage are all mocked; nothing is deleted or uploaded.
// Without edit_about on the target circle, saveProfileAction must not upload, delete or write
// anything. Submitting an empty image list used to delete every existing gallery image of the
// target circle from storage before the permission check ran.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { features } from "@/lib/data/constants";

const EXISTING_IMAGE_URL = "/storage/victim/image1.png";

let allow = false;
const authorizeCalls: unknown[][] = [];
const updateCalls: Record<string, unknown>[] = [];
const saveFileCalls: unknown[][] = [];
const deleteFileCalls: string[] = [];

mock.module("@/lib/auth/auth", () => ({
    getAuthenticatedUserDid: async () => "did-attacker",
    isAuthorized: async (...args: unknown[]) => {
        authorizeCalls.push(args);
        return allow;
    },
}));
mock.module("@/lib/data/circle", () => ({
    countCirclesAndUsers: async () => ({ circles: 0, users: 0 }),
    getCircleById: async (id: string) => ({
        _id: id,
        handle: "victim",
        images: [{ name: "a", type: "image/png", fileInfo: { url: EXISTING_IMAGE_URL } }],
    }),
    getCirclePath: async () => "/circles/victim/",
    updateCircle: async (circle: Record<string, unknown>) => {
        updateCalls.push(circle);
    },
}));
mock.module("@/lib/data/user", () => ({
    getUserByDid: async () => ({ did: "did-attacker", completedOnboardingSteps: [] }),
    getUserByHandle: async () => null,
    updateDonationIntent: async () => undefined,
}));
mock.module("@/lib/data/vdb", () => ({
    getQdrantClient: async () => null,
    getVbdCircleById: async () => null,
}));
mock.module("@/lib/data/storage", () => ({
    isFile: (value: unknown) => Boolean((value as { __testFile?: boolean } | undefined)?.__testFile),
    saveFile: async (...args: unknown[]) => {
        saveFileCalls.push(args);
        return { url: "/storage/victim/new-upload.png" };
    },
    deleteFile: async (url: string) => {
        deleteFileCalls.push(url);
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));

const { saveProfileAction } = await import("./actions");

const testFile = (name: string) => ({ __testFile: true, name, type: "image/png" });

describe("saveProfileAction authorization", () => {
    beforeEach(() => {
        allow = false;
        authorizeCalls.length = 0;
        updateCalls.length = 0;
        saveFileCalls.length = 0;
        deleteFileCalls.length = 0;
    });

    test("without permission, an empty image list deletes nothing", async () => {
        const result = await saveProfileAction("d", "c", "victim", undefined, []);

        expect(deleteFileCalls).toHaveLength(0);
        expect(updateCalls).toHaveLength(0);
        expect(result.success).toBe(false);
    });

    test("without permission, no picture or image is uploaded", async () => {
        await saveProfileAction("d", "c", "victim", testFile("p.png"), [
            { id: "1", file: testFile("i.png"), preview: "blob:x" } as any,
        ]);

        expect(saveFileCalls).toHaveLength(0);
        expect(deleteFileCalls).toHaveLength(0);
        expect(updateCalls).toHaveLength(0);
    });

    test("checks edit_about on the target circle for the session user", async () => {
        await saveProfileAction("d", "c", "victim", undefined, []);

        expect(authorizeCalls).toEqual([["did-attacker", "victim", features.settings.edit_about]]);
    });

    test("with permission, keeping the existing image saves without deleting it", async () => {
        allow = true;
        const result = await saveProfileAction("d", "c", "victim", undefined, [
            { id: "1", preview: EXISTING_IMAGE_URL, existingMediaUrl: EXISTING_IMAGE_URL } as any,
        ]);

        expect(deleteFileCalls).toHaveLength(0);
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]._id).toBe("victim");
        expect(result.success).toBe(true);
    });
});
