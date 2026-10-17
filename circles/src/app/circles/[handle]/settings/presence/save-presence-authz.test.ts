// Run: bun test "src/app/circles/[handle]/settings/presence/save-presence-authz.test.ts"
// Session, permission check, circle data and storage are all mocked; nothing is written or uploaded.
// Without edit_about on the target circle, savePresence must not upload or write anything. The
// assertions are on saveFile/updateCircle, not on `success`: an invalid offering also returns
// success: false (schema validation), which would hide a missing permission check.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { features } from "@/lib/data/constants";

let allow = false;
const authorizeCalls: unknown[][] = [];
const updateCalls: Record<string, unknown>[] = [];
const saveFileCalls: unknown[][] = [];

mock.module("@/lib/auth/auth", () => ({
    getAuthenticatedUserDid: async () => "did-attacker",
    isAuthorized: async (...args: unknown[]) => {
        authorizeCalls.push(args);
        return allow;
    },
}));
mock.module("@/lib/data/circle", () => ({
    getCircleById: async (id: string) => ({ _id: id, handle: "victim" }),
    getCirclePath: async () => "/circles/victim/",
    updateCircle: async (circle: Record<string, unknown>) => {
        updateCalls.push(circle);
    },
}));
mock.module("@/lib/data/storage", () => ({
    isFile: (value: unknown) => Boolean((value as { __testFile?: boolean } | undefined)?.__testFile),
    saveFile: async (...args: unknown[]) => {
        saveFileCalls.push(args);
        return { url: "/storage/victim-circle/offer-photo1.png" };
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));

const { savePresence } = await import("./actions");

describe("savePresence authorization", () => {
    beforeEach(() => {
        allow = false;
        authorizeCalls.length = 0;
        updateCalls.length = 0;
        saveFileCalls.length = 0;
    });

    test("without permission, nothing is written", async () => {
        const result = await savePresence({ _id: "victim-circle", needs: { text: "x" } } as any);

        expect(updateCalls).toHaveLength(0);
        expect(result.success).toBe(false);
    });

    test("without permission, no offer photo is uploaded", async () => {
        await savePresence({
            _id: "victim-circle",
            tourTeamOfferings: [{ type: "accommodation", photos: [{ file: { __testFile: true } }] }],
        } as any);

        expect(saveFileCalls).toHaveLength(0);
        expect(updateCalls).toHaveLength(0);
    });

    test("checks edit_about on the target circle for the session user", async () => {
        await savePresence({ _id: "victim-circle", needs: { text: "x" } } as any);

        expect(authorizeCalls).toEqual([["did-attacker", "victim-circle", features.settings.edit_about]]);
    });

    test("with permission, the save goes through", async () => {
        allow = true;
        const result = await savePresence({ _id: "victim-circle", needs: { text: "x" } } as any);

        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]._id).toBe("victim-circle");
        expect(result.success).toBe(true);
    });
});
