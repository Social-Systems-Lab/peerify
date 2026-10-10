import crypto from "crypto";

export function generateLocalDidAndPublicKey(): { did: string; publicKeyPem: string } {
    const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "pkcs1", format: "pem" }) as string;
    const did = crypto.createHash("sha256").update(publicKeyPem).digest("hex");
    return { did, publicKeyPem };
}
