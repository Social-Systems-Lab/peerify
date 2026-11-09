// Run: bun test src/lib/media/offer-photo-move.test.ts
// The pure rewrite steps behind scripts/move-offer-photos-private.ts.

import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { isAvifBytes, legacyOfferPhotoUrls, movedOfferPhotoRef, rewriteOfferingPhotos } from "./offer-photo-move";

const CIRCLE = "665f00000000000000000001";
const HEX = "0123456789abcdef0123456789abcdef";
const OLD = `/storage/${CIRCLE}/offer-photo1730000000000.JPG`;
const NEW_ADDRESS = `/api/offer-photo/${CIRCLE}/${HEX}.png`;

describe("offer photo move", () => {
    test("legacy URLs once each; already-moved addresses are left out", () => {
        const offerings = [
            { id: "a", photos: [{ url: OLD }, { url: NEW_ADDRESS }] },
            { id: "b", photos: [{ url: OLD }, { url: "/uploads/x.png" }] },
            { id: "c" },
        ];
        expect(legacyOfferPhotoUrls(offerings).sort()).toEqual([OLD, "/uploads/x.png"].sort());
        expect(legacyOfferPhotoUrls(undefined)).toEqual([]);
    });

    test("new name from the stored type, not the old extension", () => {
        expect(movedOfferPhotoRef(CIRCLE, HEX, "image/jpeg")).toEqual({ circleId: CIRCLE, file: `${HEX}.jpg` });
        let threw = 0;
        for (const [hex, type] of [
            [HEX, "image/svg+xml"],
            [HEX, "application/pdf"],
            ["not-random", "image/png"],
        ]) {
            try {
                movedOfferPhotoRef(CIRCLE, hex, type);
            } catch {
                threw += 1;
            }
        }
        expect(threw).toBe(3);
    });

    test("rewrite swaps every use of a moved URL and keeps the original name", () => {
        const ref = movedOfferPhotoRef(CIRCLE, HEX, "image/jpeg");
        const offerings = [
            { id: "a", detail: "Soup", photos: [{ url: OLD, fileName: "offer-photo1730000000000.JPG", originalName: "room.jpg" }] },
            { id: "b", photos: [{ url: OLD }, { url: NEW_ADDRESS }] },
            { id: "c", photos: [{ url: "/uploads/x.png" }] },
        ];
        const out = rewriteOfferingPhotos(offerings, new Map([[OLD, ref]]));
        expect(out[0]).toEqual({
            id: "a",
            detail: "Soup",
            photos: [{ url: `/api/offer-photo/${CIRCLE}/${HEX}.jpg`, fileName: `${HEX}.jpg`, originalName: "room.jpg" }],
        });
        expect(out[1].photos).toEqual([{ url: `/api/offer-photo/${CIRCLE}/${HEX}.jpg`, fileName: `${HEX}.jpg` }, { url: NEW_ADDRESS }]);
        expect(out[2]).toBe(offerings[2]);
    });
});

describe("AVIF in the move", () => {
    const box = (size: number, ...brands: string[]) =>
        Buffer.concat([Buffer.from([0, 0, 0, size]), Buffer.from("ftyp"), Buffer.from(brands[0]), Buffer.alloc(4), Buffer.from(brands.slice(1).join(""))]);

    test("a real AVIF (made by sharp) is AVIF", async () => {
        const avif = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#123456" } }).avif().toBuffer();
        expect(isAvifBytes(avif)).toBe(true);
    });

    test("major brand mif1 with avif among the compatible brands is AVIF; HEIC is not", () => {
        expect(isAvifBytes(box(24, "mif1", "miaf", "avif"))).toBe(true);
        expect(isAvifBytes(box(20, "avis", "msf1"))).toBe(true);
        expect(isAvifBytes(box(28, "heic", "mif1", "heic", "miaf"))).toBe(false);
        expect(isAvifBytes(box(24, "mif1", "heic", "miaf"))).toBe(false);
        // "avif" only after the end of the ftyp box doesn't count
        expect(isAvifBytes(Buffer.concat([box(20, "mif1", "miaf"), Buffer.from("avif")]))).toBe(false);
    });

    test("JPEG, PNG, PDF and short files are not AVIF", () => {
        expect(isAvifBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(16)]))).toBe(false);
        expect(isAvifBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(16)]))).toBe(false);
        expect(isAvifBytes(Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n"))).toBe(false);
        expect(isAvifBytes(box(20, "avif").subarray(0, 12))).toBe(false);
    });

    test("a moved AVIF gets an .avif name the route accepts", () => {
        expect(movedOfferPhotoRef(CIRCLE, HEX, "image/avif")).toEqual({ circleId: CIRCLE, file: `${HEX}.avif` });
    });
});
