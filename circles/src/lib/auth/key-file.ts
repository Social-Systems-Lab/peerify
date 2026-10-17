// The password-protected private key file: deriving its key from the password, and reading and
// checking it. Free of database imports so it can be unit-tested directly.

import crypto from "crypto";
import fs from "fs";
import path from "path";

export const KEY_FILE_ALGORITHM = "aes-256-cbc";
export const KEY_FILE_SALT = "salt.bin";
export const KEY_FILE_IV = "iv.bin";
export const KEY_FILE_ENCRYPTED_PRIVATE_KEY = "privateKey.pem.enc";
const PBKDF2_ITERATIONS = 100000;

export const deriveKeyFileKey = (password: string, salt: Buffer): Buffer =>
    crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha512");

// The same work as checking a real password, for paths that have nothing to check (unknown account,
// missing key file), so the response time doesn't reveal which case it was.
export const burnKeyFileDerivation = (password: string): void => {
    deriveKeyFileKey(password, crypto.randomBytes(16));
};

// Returns the private key PEM, or null when the key (derived from the password) is wrong.
// "Decryption didn't throw" is not enough: with a wrong key the last block is random bytes, and
// those pass the PKCS#7 padding check about 1 time in 256. Only a result that parses as a private
// key counts; random bytes never do.
export const decryptPrivateKeyPem = (encryptedHex: string, key: Buffer, iv: Buffer): string | null => {
    let pem: string;
    try {
        const decipher = crypto.createDecipheriv(KEY_FILE_ALGORITHM, key, iv);
        pem = decipher.update(encryptedHex, "hex", "utf8");
        pem += decipher.final("utf8");
    } catch {
        return null;
    }
    try {
        crypto.createPrivateKey(pem);
    } catch {
        return null;
    }
    return pem;
};

export type KeyFileCheck = { ok: true; pem: string } | { ok: false; reason: "missing" | "mismatch" };

// Checks a password against the key file in accountPath. A missing directory or file costs the same
// derivation as a wrong password.
export const readPrivateKeyWithPassword = (accountPath: string, password: string): KeyFileCheck => {
    let salt: Buffer, iv: Buffer, encryptedHex: string;
    try {
        salt = fs.readFileSync(path.join(accountPath, KEY_FILE_SALT));
        iv = fs.readFileSync(path.join(accountPath, KEY_FILE_IV));
        encryptedHex = fs.readFileSync(path.join(accountPath, KEY_FILE_ENCRYPTED_PRIVATE_KEY), "utf8");
    } catch {
        burnKeyFileDerivation(password);
        return { ok: false, reason: "missing" };
    }
    const pem = decryptPrivateKeyPem(encryptedHex, deriveKeyFileKey(password, salt), iv);
    return pem === null ? { ok: false, reason: "mismatch" } : { ok: true, pem };
};
