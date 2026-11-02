// Run: IS_BUILD=true bun test src/components/modules/home/inline-header-edit.test.ts
// Inline header editing (2026-10-27): the name/subtitle pencils (updateCircleField), "Change cover"
// (updateCircleCoverAction) and the same text limits in Settings › About (saveAbout). The database
// is in-memory fakes (testing/fake-db.ts); session, permission check and storage are stubbed, so
// nothing is uploaded or deleted.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const OWNER = "did:test:owner";
let sessionDid: string | undefined = OWNER;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined) => did === OWNER,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    updateCircle: async (update: Record<string, unknown>) => {
        const { _id, ...rest } = update;
        const set = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
        await fakeDb.col("Circles").updateOne({ _id: new ObjectId(String(_id)) }, { $set: set });
        return update;
    },
}));
const saveFileCalls: unknown[][] = [];
const deletedUrls: string[] = [];
const realStorage = await import("@/lib/data/storage");
mock.module("@/lib/data/storage", () => ({
    ...realStorage,
    saveFile: async (...args: unknown[]) => {
        saveFileCalls.push(args);
        return { originalName: "x", fileName: "x", url: `/storage/c1/new-cover-${saveFileCalls.length}.jpg` };
    },
    deleteUploadedFiles: async (urls: string[], inUseUrls: Iterable<string> = []) => {
        const keep = new Set(inUseUrls);
        deletedUrls.push(...urls.filter((url) => !keep.has(url)));
    },
}));

const { updateCircleField } = await import("./actions");
const { updateCircleCoverAction } = await import("./cover-actions");
const { saveAbout } = await import("@/app/circles/[handle]/settings/about/actions");

const CIRCLE_ID = "aaaaaaaaaaaaaaaaaaaaaaa1";
const LONG_MISSION = "m".repeat(340);
const OLD_COVER = "/storage/c1/old-cover.jpg";
const SECOND_COVER = "/storage/c1/second-cover.jpg";

const circle = (extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(CIRCLE_ID),
    did: "did:test:artist-1",
    handle: "artist-1",
    name: "Artist One",
    circleType: "circle",
    createdBy: OWNER,
    metadata: { peerify: { managedIdentity: true, identityType: "band" } },
    ...extra,
});
const stored = async () => (await fakeDb.col("Circles").findOne({ _id: new ObjectId(CIRCLE_ID) })) as any;
const form = (entries: Record<string, string | File>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.append(key, value);
    return data;
};
const image = (name = "cover.jpg", size = 1000, type = "image/jpeg") =>
    new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
    sessionDid = OWNER;
    saveFileCalls.length = 0;
    deletedUrls.length = 0;
});

describe("updateCircleField (name/subtitle pencils)", () => {
    test("trims and saves within the limits", async () => {
        fakeDb.reset({ Circles: [circle()] });
        const result = await updateCircleField(CIRCLE_ID, form({ name: "  The Band  ", description: " We play. " }));
        expect(result.success).toBe(true);
        const saved = await stored();
        expect(saved.name).toBe("The Band");
        expect(saved.description).toBe("We play.");
    });

    test("refuses an empty or spaces-only name", async () => {
        for (const name of ["", "    "]) {
            fakeDb.reset({ Circles: [circle()] });
            const result = await updateCircleField(CIRCLE_ID, form({ name }));
            expect(result.success).toBe(false);
            expect(result.message).toBe("Name can't be empty.");
            expect((await stored()).name).toBe("Artist One");
        }
    });

    test("refuses a name over 100 characters", async () => {
        fakeDb.reset({ Circles: [circle()] });
        expect((await updateCircleField(CIRCLE_ID, form({ name: "n".repeat(100) }))).success).toBe(true);
        const result = await updateCircleField(CIRCLE_ID, form({ name: "n".repeat(101) }));
        expect(result.success).toBe(false);
        expect(result.message).toContain("at most 100 characters");
    });

    test("a long mission saved as the description is refused with the limit, not cut", async () => {
        fakeDb.reset({ Circles: [circle({ mission: LONG_MISSION })] });
        const result = await updateCircleField(CIRCLE_ID, form({ description: LONG_MISSION + " edited" }));
        expect(result.success).toBe(false);
        expect(result.message).toContain("Description can be at most 200 characters");
        expect(result.message).toContain("Nothing was saved or cut");
        const saved = await stored();
        expect(saved.description).toBeUndefined();
        expect(saved.mission).toBe(LONG_MISSION);
    });

    test("mission over 500 is refused; an empty description is allowed (clears the subtitle)", async () => {
        fakeDb.reset({ Circles: [circle({ description: "Old" })] });
        expect((await updateCircleField(CIRCLE_ID, form({ mission: "m".repeat(501) }))).success).toBe(false);
        expect((await updateCircleField(CIRCLE_ID, form({ description: "  " }))).success).toBe(true);
        expect((await stored()).description).toBe("");
    });

    test("refuses a stranger and a picture over 10 MB", async () => {
        fakeDb.reset({ Circles: [circle()] });
        sessionDid = "did:test:stranger";
        expect((await updateCircleField(CIRCLE_ID, form({ name: "Taken" }))).success).toBe(false);
        sessionDid = OWNER;
        const big = await updateCircleField(CIRCLE_ID, form({ picture: image("p.jpg", 10 * 1024 * 1024 + 1) }));
        expect(big.success).toBe(false);
        expect(big.message).toContain("Image is too large");
        expect(saveFileCalls.length).toBe(0);
        expect((await stored()).name).toBe("Artist One");
    });
});

describe("updateCircleCoverAction (Change cover)", () => {
    const cover = (url: string) => ({ name: "c", type: "image/jpeg", fileInfo: { url } });

    test("refuses logged-out and non-editors before uploading anything", async () => {
        fakeDb.reset({ Circles: [circle({ images: [cover(OLD_COVER)] })] });
        sessionDid = undefined;
        expect((await updateCircleCoverAction(CIRCLE_ID, form({ cover: image() }))).success).toBe(false);
        sessionDid = "did:test:stranger";
        const result = await updateCircleCoverAction(CIRCLE_ID, form({ cover: image() }));
        expect(result.success).toBe(false);
        expect(result.message).toBe("You are not authorized to change this cover");
        expect(saveFileCalls.length).toBe(0);
        expect((await stored()).images).toEqual([cover(OLD_COVER)]);
    });

    test("refuses a non-image and a file over 10 MB", async () => {
        fakeDb.reset({ Circles: [circle()] });
        expect(
            (await updateCircleCoverAction(CIRCLE_ID, form({ cover: image("a.pdf", 10, "application/pdf") }))).success,
        ).toBe(false);
        expect(
            (await updateCircleCoverAction(CIRCLE_ID, form({ cover: image("a.jpg", 10 * 1024 * 1024 + 1) }))).success,
        ).toBe(false);
        expect(saveFileCalls.length).toBe(0);
    });

    test("replaces the first cover through saveFile, keeps the rest, deletes the old file after saving", async () => {
        fakeDb.reset({ Circles: [circle({ images: [cover(OLD_COVER), cover(SECOND_COVER)] })] });
        const result = await updateCircleCoverAction(CIRCLE_ID, form({ cover: image() }));
        expect(result.success).toBe(true);
        expect(saveFileCalls.length).toBe(1);
        expect(saveFileCalls[0].slice(1)).toEqual(["image", CIRCLE_ID, true]);
        const urls = (await stored()).images.map((m: any) => m.fileInfo.url);
        expect(urls).toEqual(["/storage/c1/new-cover-1.jpg", SECOND_COVER]);
        expect(deletedUrls).toEqual([OLD_COVER]);
    });

    test("first upload on a default hero: stock cover dropped, nothing deleted", async () => {
        fakeDb.reset({ Circles: [circle({ images: [cover("/peerify/artist.jpg")] })] });
        expect((await updateCircleCoverAction(CIRCLE_ID, form({ cover: image() }))).success).toBe(true);
        expect((await stored()).images.map((m: any) => m.fileInfo.url)).toEqual(["/storage/c1/new-cover-1.jpg"]);
        expect(deletedUrls).toEqual([]);
    });
});

describe("saveAbout text limits (Settings › About)", () => {
    const save = (values: Record<string, unknown>) =>
        saveAbout({ _id: CIRCLE_ID, name: "Artist One", handle: "artist-1", ...values } as any);

    test("an unchanged long mission doesn't block saving", async () => {
        fakeDb.reset({ Circles: [circle({ mission: "m".repeat(600) })] });
        const result = await save({ mission: "m".repeat(600), description: "  New subtitle " });
        expect(result.success).toBe(true);
        expect((await stored()).description).toBe("New subtitle");
    });

    test("a changed over-long description, or an empty name, is refused", async () => {
        fakeDb.reset({ Circles: [circle()] });
        const long = await save({ description: "d".repeat(201) });
        expect(long.success).toBe(false);
        expect(long.message).toContain("at most 200 characters");
        const empty = await save({ name: "   " });
        expect(empty.success).toBe(false);
        expect(empty.message).toBe("Name can't be empty.");
        expect((await stored()).name).toBe("Artist One");
    });
});
