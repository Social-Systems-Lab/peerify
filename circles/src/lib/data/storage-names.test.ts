// Run: bun test src/lib/data/storage-names.test.ts
// MinIO is mocked; nothing is uploaded. The public bucket is served to anyone with a URL, so
// saveFile must store objects under an unguessable name, never a timestamp.

import { describe, expect, mock, test } from "bun:test";

const putNames: string[] = [];

mock.module("minio", () => ({
    Client: class {
        bucketExists = async () => true;
        makeBucket = async () => undefined;
        setBucketPolicy = async () => undefined;
        statObject = async () => {
            throw new Error("not found");
        };
        putObject = async (_bucket: string, name: string) => {
            putNames.push(name);
        };
    },
}));

const { saveFile } = await import("./storage");

const textFile = () => new File(["hello"], "note.txt", { type: "text/plain" });

describe("saveFile object names", () => {
    test("folder and prefix kept, then 32 random hex characters", async () => {
        const info = await saveFile(textFile(), "chat-attachment", "665f00000000000000000001", true);

        expect(/^\/storage\/665f00000000000000000001\/chat-attachment-[0-9a-f]{32}(\.[a-z0-9]+)?$/.test(info.url)).toBe(true);
        expect(putNames.at(-1)).toBe(info.url.slice("/storage/".length));
        // No timestamp: the first 8 digits of Date.now() (about a 15-minute span) don't appear.
        expect(info.fileName.includes(String(Date.now()).slice(0, 8))).toBe(false);
    });

    test("two uploads in the same millisecond still get different names", async () => {
        const [a, b] = await Promise.all([
            saveFile(textFile(), "offer-photo", "circle-1", true),
            saveFile(textFile(), "offer-photo", "circle-1", true),
        ]);

        expect(a.url).not.toBe(b.url);
    });
});
