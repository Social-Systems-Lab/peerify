// Run: bun test src/lib/auth/key-file.test.ts
// No mocks: key-file.ts has no database imports.

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "bun:test";
import {
    decryptPrivateKeyPem,
    deriveKeyFileKey,
    KEY_FILE_ALGORITHM,
    KEY_FILE_ENCRYPTED_PRIVATE_KEY,
    KEY_FILE_IV,
    KEY_FILE_SALT,
    readPrivateKeyWithPassword,
} from "./key-file";

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

// Real key files in a temporary directory, written the way createUserAccount writes them (with the
// app's own key derivation, 100,000 rounds).
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "key-file-test-"));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
const writeAccount = (name: string, password: string): string => {
    const dir = path.join(tmpRoot, name);
    fs.mkdirSync(dir);
    const s = crypto.randomBytes(16);
    const v = crypto.randomBytes(16);
    const c = crypto.createCipheriv(KEY_FILE_ALGORITHM, deriveKeyFileKey(password, s), v);
    fs.writeFileSync(path.join(dir, KEY_FILE_SALT), s);
    fs.writeFileSync(path.join(dir, KEY_FILE_IV), v);
    fs.writeFileSync(path.join(dir, KEY_FILE_ENCRYPTED_PRIVATE_KEY), c.update(pem, "utf8", "hex") + c.final("hex"));
    return dir;
};
const timed = (fn: () => void): number => {
    const start = performance.now();
    fn();
    return performance.now() - start;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe("readPrivateKeyWithPassword", () => {
    const account = writeAccount("account", "right password");

    test("the right password returns the key", () => {
        expect(readPrivateKeyWithPassword(account, "right password")).toEqual({ ok: true, pem });
    });

    test("a wrong password is a mismatch", () => {
        expect(readPrivateKeyWithPassword(account, "wrong password")).toEqual({ ok: false, reason: "mismatch" });
    });

    test("a missing directory or a missing file is reported as missing", () => {
        expect(readPrivateKeyWithPassword(path.join(tmpRoot, "nope"), "x")).toEqual({ ok: false, reason: "missing" });
        const partial = writeAccount("partial", "x");
        fs.rmSync(path.join(partial, KEY_FILE_IV));
        expect(readPrivateKeyWithPassword(partial, "x")).toEqual({ ok: false, reason: "missing" });
    });

    // The missing case runs a dummy derivation, so it costs about as much as a wrong password
    // instead of returning at once. Loose bound (half), so a busy machine doesn't make it flaky.
    test("a missing key file takes about as long as a wrong password", () => {
        const missing = median([1, 2, 3].map(() => timed(() => readPrivateKeyWithPassword(path.join(tmpRoot, "nope"), "x"))));
        const wrong = median([1, 2, 3].map(() => timed(() => readPrivateKeyWithPassword(account, "wrong"))));
        expect(missing).toBeGreaterThan(wrong * 0.5);
    });
});
