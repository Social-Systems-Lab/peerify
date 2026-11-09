import { describe, expect, test } from "bun:test";
import { createLeftoverScan, fileNameOf } from "./public-leftovers";

const objects = [
    { name: "aaaaaaaaaaaaaaaaaaaaaaaa/offer-photo-1690000000000.jpg", size: 10 },
    { name: "aaaaaaaaaaaaaaaaaaaaaaaa/Offer-Photo-1690000000001.PNG", size: 20 },
    { name: "bbbbbbbbbbbbbbbbbbbbbbbb/verification-attachment-1690000000002.pdf", size: 30 },
    { name: "bbbbbbbbbbbbbbbbbbbbbbbb/verification-attachment1690000000003.jpg", size: 40 },
    { name: "bbbbbbbbbbbbbbbbbbbbbbbb/picture-1690000000004.jpg", size: 50 },
    { name: "cccccccccccccccccccccccc/cover.webp", size: 60 },
];

describe("public leftovers", () => {
    test("only names step 6 refuses are candidates", () => {
        const scan = createLeftoverScan(objects);
        expect(scan.candidates.map((c) => c.size)).toEqual([10, 20, 30, 40]);
    });

    test("nothing mentioned: all candidates are unreferenced", () => {
        const scan = createLeftoverScan(objects);
        scan.scan(JSON.stringify({ picture: { url: "/storage/bbbbbbbbbbbbbbbbbbbbbbbb/picture-1690000000004.jpg" } }));
        expect(scan.unreferenced().map((o) => o.size)).toEqual([10, 20, 30, 40]);
        expect(scan.mentionedCount()).toBe(0);
    });

    test("a mention anywhere, in any case, keeps the file", () => {
        const scan = createLeftoverScan(objects);
        // An offer still using the old address.
        scan.scan(
            JSON.stringify({
                tourTeamOfferings: [
                    { photos: [{ url: "/storage/aaaaaaaaaaaaaaaaaaaaaaaa/offer-photo-1690000000000.jpg" }] },
                ],
            }),
        );
        // A full URL, different case, in some other field.
        scan.scan(
            JSON.stringify({
                note: "see HTTPS://PEERIFY.ONE/storage/aaaaaaaaaaaaaaaaaaaaaaaa/offer-photo-1690000000001.png",
            }),
        );
        // A pending move row (offerPhotoMoves) keeps its public key.
        scan.scan(JSON.stringify({ publicKey: "bbbbbbbbbbbbbbbbbbbbbbbb/verification-attachment-1690000000002.pdf" }));
        expect(scan.unreferenced()).toEqual([{ name: objects[3].name, size: 40 }]);
        expect(scan.mentionedCount()).toBe(3);
    });

    test("a mention under another folder still counts (kept, to be safe)", () => {
        const scan = createLeftoverScan(objects);
        scan.scan(JSON.stringify({ url: "/storage/zzz/verification-attachment1690000000003.jpg" }));
        expect(scan.unreferenced().map((o) => o.size)).toEqual([10, 20, 30]);
    });

    test("fileNameOf takes the last segment, lower case", () => {
        expect(fileNameOf("a/b/Offer-Photo-1.JPG")).toBe("offer-photo-1.jpg");
        expect(fileNameOf("offer-photo-1.jpg")).toBe("offer-photo-1.jpg");
    });
});
