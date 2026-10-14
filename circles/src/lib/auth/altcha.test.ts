// Run: bun test src/lib/auth/altcha.test.ts
// Real altcha-lib challenges, solved here with its own solver (about a second per solve). Only the
// used-challenge store is faked: inserting an _id twice fails with code 11000, like MongoDB.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createChallenge, solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import type { Challenge } from "altcha-lib/types";

let used = new Map<string, { _id: string; expiresAt: Date }>();
let storeDown = false;
const fakeUsed = {
    createIndex: async () => "expiresAt_1",
    insertOne: async (doc: { _id: string; expiresAt: Date }) => {
        if (storeDown) throw new Error("connection refused");
        if (used.has(doc._id)) throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
        used.set(doc._id, doc);
        return { insertedId: doc._id };
    },
};
mock.module("@/lib/data/db", () => ({ UsedAltchaChallenges: fakeUsed }));

const HMAC_KEY = "test-hmac-key-not-a-real-secret";
process.env.ALTCHA_HMAC_KEY = HMAC_KEY;

const { checkAltchaPayload, createAltchaChallenge, verifyAltchaPayload } = await import("./altcha");

const encode = (challenge: Challenge, solution: { counter: number; derivedKey: string; time?: number }) =>
    Buffer.from(JSON.stringify({ challenge, solution })).toString("base64");

async function solvedPayload(issuedAt = new Date()): Promise<{ challenge: Challenge; payload: string }> {
    const challenge = await createAltchaChallenge(HMAC_KEY, issuedAt);
    const solution = await solveChallenge({ challenge, deriveKey });
    if (!solution) throw new Error("solver timed out");
    return { challenge, payload: encode(challenge, solution) };
}

const plusSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

describe("createAltchaChallenge", () => {
    test("deterministic, signed, with an issue time and a 10 minute expiry", async () => {
        const at = new Date();
        const c = await createAltchaChallenge(HMAC_KEY, at);
        expect(typeof c.signature).toBe("string");
        expect(typeof c.parameters.keySignature).toBe("string");
        // Deterministic mode: the prefix is half the derived key, not the default "00".
        expect(c.parameters.keyPrefix.length).toBe(32);
        expect(c.parameters.data?.iat).toBe(at.getTime());
        expect(c.parameters.expiresAt).toBe(Math.floor(at.getTime() / 1000) + 600);
        expect(c.parameters.cost).toBe(5000);
    });
});

describe("checkAltchaPayload", () => {
    beforeEach(() => {
        used = new Map();
        storeDown = false;
    });

    test("a solved challenge passes once, then is refused as replayed", async () => {
        const { payload } = await solvedPayload();
        const first = await checkAltchaPayload(payload);
        expect(first.ok).toBe(true);
        expect(used.size).toBe(1);
        expect(await checkAltchaPayload(payload)).toEqual({ ok: false, reason: "replayed" });
        expect(await verifyAltchaPayload(payload)).toBe(false);
    });

    test("the used entry expires with the challenge", async () => {
        const at = new Date();
        const { payload, challenge } = await solvedPayload(at);
        await checkAltchaPayload(payload);
        const [entry] = [...used.values()];
        expect(entry.expiresAt.getTime()).toBe((challenge.parameters.expiresAt as number) * 1000);
    });

    test("too fast is refused without spending the challenge; the same payload passes later", async () => {
        const at = new Date();
        const { payload } = await solvedPayload(at);
        expect(await checkAltchaPayload(payload, { minFormAgeSeconds: 3, now: plusSeconds(at, 2) })).toEqual({
            ok: false,
            reason: "too_fast",
        });
        expect(used.size).toBe(0);
        const later = await checkAltchaPayload(payload, { minFormAgeSeconds: 3, now: plusSeconds(at, 4) });
        expect(later.ok).toBe(true);
        expect(later.ok && later.formAgeSeconds).toBe(4);
    });

    test("no proof of work: counter 0 on an old-style (non-deterministic) challenge is refused", async () => {
        // The pre-(c) challenge shape. altcha-lib before 2.3.2 accepted this in verifySolution
        // (GHSA-rx38-p542-v527); our own checks refuse it whatever the library version.
        const challenge = await createChallenge({
            algorithm: "PBKDF2/SHA-256",
            cost: 5000,
            deriveKey,
            data: { iat: Date.now() - 60_000 },
            expiresAt: new Date(Date.now() + 600_000),
            hmacSignatureSecret: HMAC_KEY,
        });
        const nonce = Buffer.from(challenge.parameters.nonce, "hex");
        const password = Buffer.alloc(nonce.length + 4);
        nonce.copy(password);
        password.writeUInt32BE(0, nonce.length);
        const { derivedKey } = await deriveKey(
            challenge.parameters,
            Buffer.from(challenge.parameters.salt, "hex"),
            password,
        );
        const payload = encode(challenge, { counter: 0, derivedKey: Buffer.from(derivedKey).toString("hex") });
        expect(await checkAltchaPayload(payload)).toEqual({ ok: false, reason: "invalid" });
        expect(used.size).toBe(0);
    });

    test("a wrong derived key on a deterministic challenge is refused", async () => {
        const challenge = await createAltchaChallenge(HMAC_KEY);
        const solution = await solveChallenge({ challenge, deriveKey });
        const wrongKey = encode(challenge, { ...solution!, derivedKey: "00".repeat(32) });
        expect(await checkAltchaPayload(wrongKey)).toEqual({ ok: false, reason: "invalid" });
        expect(used.size).toBe(0);
        // The right key passes (checked against the key signature; the key itself is the proof).
        expect((await checkAltchaPayload(encode(challenge, solution!))).ok).toBe(true);
    });

    test("a moved issue time breaks the signature", async () => {
        const { challenge, payload } = await solvedPayload();
        const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
        decoded.challenge.parameters.data.iat = (challenge.parameters.data!.iat as number) - 60_000;
        const tampered = Buffer.from(JSON.stringify(decoded)).toString("base64");
        expect(await checkAltchaPayload(tampered, { minFormAgeSeconds: 3 })).toEqual({ ok: false, reason: "invalid" });
    });

    test("an expired challenge is refused", async () => {
        const { payload } = await solvedPayload(new Date(Date.now() - 11 * 60 * 1000));
        expect(await checkAltchaPayload(payload)).toEqual({ ok: false, reason: "invalid" });
    });

    test("fails closed when the used-challenge store is unavailable", async () => {
        const { payload } = await solvedPayload();
        storeDown = true;
        expect(await checkAltchaPayload(payload)).toEqual({ ok: false, reason: "invalid" });
    });

    test("missing, malformed or unconfigured is invalid", async () => {
        expect(await checkAltchaPayload(undefined)).toEqual({ ok: false, reason: "invalid" });
        expect(await checkAltchaPayload("not base64 json")).toEqual({ ok: false, reason: "invalid" });
        const { payload } = await solvedPayload();
        delete process.env.ALTCHA_HMAC_KEY;
        try {
            expect(await checkAltchaPayload(payload)).toEqual({ ok: false, reason: "invalid" });
        } finally {
            process.env.ALTCHA_HMAC_KEY = HMAC_KEY;
        }
    });
});
