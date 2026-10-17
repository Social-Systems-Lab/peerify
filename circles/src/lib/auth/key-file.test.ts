// Run: bun test src/lib/auth/key-file.test.ts
// No mocks: key-file.ts has no database imports.

import crypto from "crypto";
import { describe, expect, test } from "bun:test";
import { decryptPrivateKeyPem, KEY_FILE_ALGORITHM } from "./key-file";

// Same format as createUserAccount writes: a PKCS#1 PEM, AES-256-CBC, hex.
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(16);
// Fewer rounds than the app's 100,000 to keep the test fast; the round count doesn't matter here.
const deriveKey = (password: string) => crypto.pbkdf2Sync(password, salt, 1000, 32, "sha512");
const cipher = crypto.createCipheriv(KEY_FILE_ALGORITHM, deriveKey("right password"), iv);
const encryptedHex = cipher.update(pem, "utf8", "hex") + cipher.final("hex");

describe("decryptPrivateKeyPem", () => {
    test("the right password returns the private key", () => {
        expect(decryptPrivateKeyPem(encryptedHex, deriveKey("right password"), iv)).toBe(pem);
    });

    test("a wrong password returns null", () => {
        expect(decryptPrivateKeyPem(encryptedHex, deriveKey("wrong password"), iv)).toBeNull();
    });

    // A wrong key turns the last block into random bytes, which pass the PKCS#7 padding check
    // about 1 time in 256, so "decrypt didn't throw" alone accepted ~20 of these.
    test("5,000 random wrong keys are all rejected", () => {
        let paddingPassed = 0;
        let accepted = 0;
        for (let i = 0; i < 5000; i++) {
            const key = crypto.randomBytes(32);
            try {
                const decipher = crypto.createDecipheriv(KEY_FILE_ALGORITHM, key, iv);
                decipher.update(encryptedHex, "hex");
                decipher.final();
                paddingPassed++;
            } catch {
                // padding check failed
            }
            if (decryptPrivateKeyPem(encryptedHex, key, iv) !== null) {
                accepted++;
            }
        }
        // Shows the test really exercised the padding case (expected ~20; 0 is ~1e-9 likely).
        expect(paddingPassed).toBeGreaterThan(0);
        expect(accepted).toBe(0);
    });
});
