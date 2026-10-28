// Run: bun test src/lib/data/verification-attachments.test.ts
// Verification attachments as a viewer receives them (serializeVerificationMessage). No database or
// storage: only the serialiser runs.

import { describe, expect, test } from "bun:test";
import { randomBytes } from "crypto";

// A throwaway key for this run only.
process.env.JWT_SECRET = randomBytes(32).toString("hex");
// db.ts loads without a database when IS_BUILD is set (it never connects); the serialiser doesn't use it.
process.env.IS_BUILD = "true";

const { serializeVerificationMessage } = await import("./verification-workflow");
const { verifyPrivateMediaToken } = await import("@/lib/media/private-media-token");

const KEY = "verification/665f00000000000000000001/0123456789abcdef0123456789abcdef.png";

const message = (attachments: unknown[]) =>
    ({
        _id: "m1",
        requestId: "r1",
        senderDid: "did:test:applicant",
        senderRole: "applicant",
        body: "",
        attachments,
        createdAt: new Date("2026-10-28T10:00:00Z"),
    }) as any;

describe("serializeVerificationMessage attachments", () => {
    test("a private attachment becomes a signed link; the key and movedFrom never leave", async () => {
        const out = await serializeVerificationMessage(
            message([
                {
                    key: KEY,
                    originalName: "ID card.png",
                    contentType: "image/png",
                    size: 10,
                    movedFrom: "/storage/x/verification-attachment1700.png",
                },
            ]),
            "Applicant",
        );

        const [attachment] = out.attachments;
        expect(attachment.url.startsWith("/api/private-media?t=")).toBe(true);
        expect(attachment.isImage).toBe(true);
        expect(attachment.expires).toBe(true);
        expect(attachment.originalName).toBe("ID card.png");
        const serialized = JSON.stringify(out);
        expect(serialized.includes(KEY)).toBe(false);
        expect(serialized.includes("movedFrom")).toBe(false);
        expect(serialized.includes("verification-attachment1700")).toBe(false);

        const token = decodeURIComponent(attachment.url.slice("/api/private-media?t=".length));
        expect(await verifyPrivateMediaToken(token)).toEqual({ key: KEY, name: "ID card.png" });
    });

    test("a PDF is not an image", async () => {
        const out = await serializeVerificationMessage(
            message([{ key: KEY.replace(".png", ".pdf"), originalName: "a.pdf", contentType: "application/pdf", size: 1 }]),
            "Applicant",
        );
        expect(out.attachments[0].isImage).toBe(false);
    });

    test("an attachment saved before the move passes through unchanged", async () => {
        const legacy = { url: "/storage/c/verification-attachment1700.pdf", fileName: "verification-attachment1700.pdf", originalName: "a.pdf" };
        const out = await serializeVerificationMessage(message([legacy]), "Applicant");
        expect(out.attachments).toEqual([legacy]);
    });
});
