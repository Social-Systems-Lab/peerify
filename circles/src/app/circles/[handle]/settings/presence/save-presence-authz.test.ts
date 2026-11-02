// Run: bun test "src/app/circles/[handle]/settings/presence/save-presence-authz.test.ts"
// Session, permission check, circle data and storage are all mocked; nothing is written or uploaded.
// Without edit_about on the target circle, savePresence must not upload or write anything. The
// assertions are on savePrivateFile/updateCircle, not on `success`: an invalid offering also returns
// success: false (schema validation), which would hide a missing permission check.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { features } from "@/lib/data/constants";

let allow = false;
const authorizeCalls: unknown[][] = [];
const updateCalls: Record<string, unknown>[] = [];
const saveFileCalls: unknown[][] = [];
const removedKeys: string[] = [];
let savedContentType = "image/jpeg";
const OWN = "665f000000000000000000aa";
const OTHER = "665f000000000000000000bb";
const PHOTO_FILE = "0123456789abcdef0123456789abcdef.jpg";
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
    savePrivateFile: async (...args: unknown[]) => {
        saveFileCalls.push(args);
        return { key: `${args[1]}/${PHOTO_FILE}`, originalName: "room.jpg", contentType: savedContentType, size: 3 };
    },
    removePrivateObject: async (key: string) => {
        removedKeys.push(key);
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

describe("savePresence offer photos (private, /api/offer-photo)", () => {
    const offering = (photos: unknown[]) => ({ id: "meal-1", type: "home_cooked_meal", detail: "Soup", photos });
    const savedPhotos = () => ((updateCalls[0]?.tourTeamOfferings as any[]) ?? [])[0]?.photos;

    beforeEach(() => {
        allow = true;
        updateCalls.length = 0;
        saveFileCalls.length = 0;
        removedKeys.length = 0;
        savedContentType = "image/jpeg";
        storedOfferings = [];
    });

    test("a new photo goes to the private bucket and is stored as its address", async () => {
        await savePresence({ _id: OWN, tourTeamOfferings: [offering([{ file: { __testFile: true } }])] } as any);
        expect(saveFileCalls[0][1]).toBe(`offer-photos/${OWN}`);
        expect(savedPhotos()).toEqual([
            { url: `/api/offer-photo/${OWN}/${PHOTO_FILE}`, fileName: PHOTO_FILE, originalName: "room.jpg" },
        ]);
    });

    test("an upload that isn't a plain image is removed again and dropped", async () => {
        savedContentType = "application/pdf";
        await savePresence({ _id: OWN, tourTeamOfferings: [offering([{ file: { __testFile: true } }])] } as any);
        expect(removedKeys).toEqual([`offer-photos/${OWN}/${PHOTO_FILE}`]);
        expect(savedPhotos()).toEqual([]);
    });

    test("this circle's photo address is kept; another circle's is dropped", async () => {
        const own = `/api/offer-photo/${OWN}/${PHOTO_FILE}`;
        const other = `/api/offer-photo/${OTHER}/${PHOTO_FILE}`;
        await savePresence({ _id: OWN, tourTeamOfferings: [offering([{ url: own }, { url: other }, { existingMediaUrl: other }])] } as any);
        expect(savedPhotos().map((photo: { url: string }) => photo.url)).toEqual([own]);
    });

    test("an old /storage photo still passes through", async () => {
        const legacy = { url: `/storage/${OWN}/offer-photo1.png`, fileName: "offer-photo1.png", originalName: "a.png" };
        await savePresence({ _id: OWN, tourTeamOfferings: [offering([legacy])] } as any);
        expect(savedPhotos()).toEqual([legacy]);
    });
});
