// Run: bun test src/lib/media/offer-photo-move.test.ts
// The pure rewrite steps behind scripts/move-offer-photos-private.ts.

import { describe, expect, test } from "bun:test";
import { legacyOfferPhotoUrls, movedOfferPhotoRef, rewriteOfferingPhotos } from "./offer-photo-move";

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
