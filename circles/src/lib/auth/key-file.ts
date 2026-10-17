// Decrypting the password-protected private key file. Free of database imports so it can be
// unit-tested directly.

import crypto from "crypto";

export const KEY_FILE_ALGORITHM = "aes-256-cbc";

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
