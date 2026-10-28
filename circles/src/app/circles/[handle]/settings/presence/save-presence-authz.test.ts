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
const offsetCalls: string[] = [];
let storedOfferings: Record<string, unknown>[] = [];

mock.module("@/lib/auth/auth", () => ({
    getAuthenticatedUserDid: async () => "did-attacker",
    isAuthorized: async (...args: unknown[]) => {
        authorizeCalls.push(args);
        return allow;
    },
}));
mock.module("@/lib/data/circle", () => ({
    getCircleById: async (id: string) => ({ _id: id, handle: "victim", tourTeamOfferings: storedOfferings }),
    getCirclePath: async () => "/circles/victim/",
    updateCircle: async (circle: Record<string, unknown>) => {
        updateCalls.push(circle);
    },
    ensureOfferPinOffset: async (id: string) => {
        offsetCalls.push(id);
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
        offsetCalls.length = 0;
        storedOfferings = [];
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

// Show space (hosting_show) is retired: new ones are refused from every path, an existing one is
// kept exactly as stored.
describe("savePresence and retired offer types", () => {
    const meal = { id: "meal-1", type: "home_cooked_meal", detail: "Soup" };
    const storedShowSpace = { id: "show-1", type: "hosting_show", detail: "Living room, 20 people" };

    beforeEach(() => {
        allow = true;
        updateCalls.length = 0;
        saveFileCalls.length = 0;
        offsetCalls.length = 0;
        storedOfferings = [];
    });

    test("a new Show space offer is refused, with nothing uploaded or written", async () => {
        const result = await savePresence({
            _id: "own-circle",
            tourTeamOfferings: [meal, { id: "hosting_show", type: "hosting_show", photos: [{ file: { __testFile: true } }] }],
        } as any);

        expect(result.success).toBe(false);
        expect(result.message).toContain("Add a space");
        expect(saveFileCalls).toHaveLength(0);
        expect(updateCalls).toHaveLength(0);
    });

    test("an existing Show space offer is kept as stored, edits ignored", async () => {
        storedOfferings = [storedShowSpace];
        const result = await savePresence({
            _id: "own-circle",
            tourTeamOfferings: [{ ...storedShowSpace, detail: "Edited" }, meal],
        } as any);

        expect(result.success).toBe(true);
        expect(updateCalls[0].tourTeamOfferings).toEqual([storedShowSpace, meal]);
    });

    test("an existing offer can't be turned into a Show space", async () => {
        storedOfferings = [meal];
        const result = await savePresence({
            _id: "own-circle",
            tourTeamOfferings: [{ ...meal, type: "hosting_show" }],
        } as any);

        expect(result.success).toBe(false);
        expect(updateCalls).toHaveLength(0);
    });

    test("saving offers gives the circle its offer pin offset", async () => {
        await savePresence({ _id: "own-circle", tourTeamOfferings: [meal] } as any);

        expect(offsetCalls).toEqual(["own-circle"]);
    });
});
