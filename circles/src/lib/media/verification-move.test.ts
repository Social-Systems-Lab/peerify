// Run: bun test src/lib/media/verification-move.test.ts
// The pure rewrite steps behind scripts/move-verification-attachments-private.ts.

import { describe, expect, test } from "bun:test";
import {
    isMovedPendingDelete,
    isPublicAttachment,
    movedAttachment,
    privateKeyForMove,
    publicKeyFromStorageUrl,
    withoutMovedFrom,
} from "./verification-move";

const HEX = "0123456789abcdef0123456789abcdef";
const legacy = {
    url: "/storage/665f00000000000000000001/verification-attachment1730000000000.PDF",
    fileName: "verification-attachment1730000000000.PDF",
    originalName: "ID card.pdf",
};

describe("verification attachment move", () => {
    test("public key from a /storage URL only", () => {
        expect(publicKeyFromStorageUrl(legacy.url)).toBe("665f00000000000000000001/verification-attachment1730000000000.PDF");
        expect(publicKeyFromStorageUrl("/uploads/123-verification-attachment.pdf")).toBeNull();
        expect(publicKeyFromStorageUrl("https://example.com/storage/x/y.pdf")).toBeNull();
        expect(publicKeyFromStorageUrl("/storage/../audio/x")).toBeNull();
        expect(publicKeyFromStorageUrl("/storage/onlyfolder")).toBeNull();
    });

    test("private key in the owner's verification folder, plain extension kept", () => {
        expect(privateKeyForMove("665f00000000000000000001/verification-attachment1730000000000.PDF", HEX)).toBe(
            `verification/665f00000000000000000001/${HEX}.pdf`,
        );
        expect(privateKeyForMove("abc/verification-attachment17.<b>", HEX)).toBe(`verification/abc/${HEX}`);
        let threw = false;
        try {
            privateKeyForMove("abc/x.pdf", "not-random");
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);
    });

    test("copy rewrite keeps the name and remembers the old URL; delete drops it", () => {
        const moved = movedAttachment(legacy, `verification/abc/${HEX}.pdf`, "application/pdf", 42);
        expect(moved).toEqual({
            key: `verification/abc/${HEX}.pdf`,
            originalName: "ID card.pdf",
            contentType: "application/pdf",
            size: 42,
            movedFrom: legacy.url,
        });
        expect(isPublicAttachment(legacy)).toBe(true);
        expect(isPublicAttachment(moved)).toBe(false);
        expect(isMovedPendingDelete(moved)).toBe(true);

        const done = withoutMovedFrom(moved);
        expect("movedFrom" in done).toBe(false);
        expect(isMovedPendingDelete(done)).toBe(false);
        expect(isPublicAttachment(done)).toBe(false);
    });

    test("no original name falls back to the file name, then 'file'", () => {
        expect(movedAttachment({ url: legacy.url, fileName: "f.pdf" }, "k", "t", 1).originalName).toBe("f.pdf");
        expect(movedAttachment({ url: legacy.url, originalName: null, fileName: null }, "k", "t", 1).originalName).toBe("file");
    });
});
