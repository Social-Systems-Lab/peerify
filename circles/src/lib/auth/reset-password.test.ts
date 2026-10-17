// Run: bun test src/lib/auth/reset-password.test.ts
// The database is mocked; key files are real, in a temporary USERS_DIR that is removed afterwards.

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeCollection, type FakeCollection } from "@/lib/testing/fake-collection";
import { readPrivateKeyWithPassword } from "./key-file";

const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), "reset-password-test-"));
afterAll(() => fs.rmSync(usersDir, { recursive: true, force: true }));

let circles: FakeCollection = createFakeCollection();
mock.module("@/lib/data/db", () => ({
    Circles: {
        findOne: (...args: Parameters<FakeCollection["findOne"]>) => circles.findOne(...args),
        updateOne: (...args: Parameters<FakeCollection["updateOne"]>) => circles.updateOne(...args),
        findOneAndUpdate: (...args: Parameters<FakeCollection["findOneAndUpdate"]>) => circles.findOneAndUpdate(...args),
    },
}));
// bun's module mocks are process-wide; this exposes everything src/lib/auth/actions.ts imports.
mock.module("@/lib/auth/auth", () => ({
    AuthenticationError: class AuthenticationError extends Error {},
    authenticateUser: () => undefined,
    burnPasswordCheck: () => undefined,
    createUserSession: async () => "session",
    getAuthenticatedUserDid: async () => undefined,
    USERS_DIR: usersDir,
    SALT_FILENAME: "salt.bin",
    IV_FILENAME: "iv.bin",
    PUBLIC_KEY_FILENAME: "publicKey.pem",
    PRIVATE_KEY_FILENAME: "privateKey.pem",
    ENCRYPTED_PRIVATE_KEY_FILENAME: "privateKey.pem.enc",
    ENCRYPTION_ALGORITHM: "aes-256-cbc",
}));
mock.module("@/lib/data/user", () => ({ getUserPrivate: async () => ({}) }));
mock.module("@/lib/data/first-email-verification", () => ({ completeFirstEmailVerification: async () => undefined }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));

const { resetPassword } = await import("./actions");

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const TOKEN = "reset-token-value";

const seed = (expiry: Date) => {
    circles = createFakeCollection([
        {
            _id: "u1",
            did: "did-reset",
            email: "owner@example.test",
            passwordResetToken: sha256(TOKEN),
            passwordResetTokenExpiry: expiry,
        },
    ]);
};

describe("resetPassword", () => {
    beforeEach(() => {
        fs.rmSync(path.join(usersDir, "did-reset"), { recursive: true, force: true });
        seed(new Date(Date.now() + 3600 * 1000));
    });

    test("a valid token sets the new password and is used up", async () => {
        expect(await resetPassword(TOKEN, "new password 1")).toEqual({ success: true });
        expect(readPrivateKeyWithPassword(path.join(usersDir, "did-reset"), "new password 1").ok).toBe(true);
        expect(circles.docs[0].passwordResetToken).toBeNull();
        expect(await resetPassword(TOKEN, "new password 2")).toEqual({
            success: false,
            error: "Invalid or expired reset token.",
        });
    });

    // Two requests with the same token at the same moment (double submit, or a stolen link raced
    // against the owner): exactly one may set a password.
    test("two concurrent resets with one token: exactly one succeeds", async () => {
        const results = await Promise.all([
            resetPassword(TOKEN, "first password"),
            resetPassword(TOKEN, "second password"),
        ]);
        expect(results.filter((r) => r.success)).toHaveLength(1);
        const account = path.join(usersDir, "did-reset");
        const winner = results[0].success ? "first password" : "second password";
        const loser = results[0].success ? "second password" : "first password";
        expect(readPrivateKeyWithPassword(account, winner).ok).toBe(true);
        expect(readPrivateKeyWithPassword(account, loser).ok).toBe(false);
    });

    test("an expired token is refused and cleared", async () => {
        seed(new Date(Date.now() - 1000));
        expect(await resetPassword(TOKEN, "new password 1")).toEqual({
            success: false,
            error: "Reset token has expired.",
        });
        expect(circles.docs[0].passwordResetToken).toBeNull();
        expect(fs.existsSync(path.join(usersDir, "did-reset"))).toBe(false);
    });

    test("an unknown token is refused", async () => {
        expect(await resetPassword("other-token", "new password 1")).toEqual({
            success: false,
            error: "Invalid or expired reset token.",
        });
    });
});
