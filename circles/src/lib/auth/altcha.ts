import crypto from "crypto";
import { createChallenge, randomInt, verifySolution } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import type { Challenge, Payload } from "altcha-lib/types";
import { UsedAltchaChallenges } from "@/lib/data/db";

// Expired entries are only housekeeping: an expired challenge already fails verifySolution.
UsedAltchaChallenges?.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ALTCHA_TTL_SECONDS = 10 * 60;
const ALTCHA_ALGORITHM = "PBKDF2/SHA-256";
const ALTCHA_COST = 5000;
// Deterministic mode: the server picks the counter the solver has to reach, so the work is spread
// evenly between these bounds instead of following a long-tailed random search. Measured on the old
// box: ~0.83 ms per PBKDF2 derivation at cost 5000 on one core. The widget splits the counter range
// across its workers (hardwareConcurrency, at most 4 on low-memory phones). At an assumed ~6 ms per
// derivation on a slow phone, 1200 / 4 workers ≈ 1.8 s worst case, ~1.2 s on average. A script on
// one server core spends ~0.65 s per challenge on average.
const ALTCHA_COUNTER_MIN = 400;
const ALTCHA_COUNTER_MAX = 1200;

// Separate secret for the derived-key signature, derived from ALTCHA_HMAC_KEY so no new env var is
// needed.
const keySignatureSecret = (hmacKey: string): string =>
    crypto.createHmac("sha256", hmacKey).update("altcha-key-signature").digest("hex");

// `data.iat` is the issue time in ms. It is covered by the challenge signature, so a client can't
// move it; the signup form uses it as the moment the form was shown (the widget fetches on load).
export async function createAltchaChallenge(hmacKey: string, now: Date = new Date()): Promise<Challenge> {
    return createChallenge({
        algorithm: ALTCHA_ALGORITHM,
        cost: ALTCHA_COST,
        counter: randomInt(ALTCHA_COUNTER_MAX, ALTCHA_COUNTER_MIN),
        data: { iat: now.getTime() },
        deriveKey,
        expiresAt: new Date(now.getTime() + ALTCHA_TTL_SECONDS * 1000),
        hmacKeySignatureSecret: keySignatureSecret(hmacKey),
        hmacSignatureSecret: hmacKey,
    });
}

function parseAltchaPayload(payload: string): Payload | null {
    try {
        const parsed = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
        if (!parsed || typeof parsed !== "object" || !parsed.challenge || !parsed.solution) {
            return null;
        }
        return parsed as Payload;
    } catch {
        return null;
    }
}

export type AltchaCheck =
    | { ok: true; formAgeSeconds: number; solveMs: number | null }
    // invalid: missing, malformed, wrong signature or solution, expired, or issued before this
    //   version (no key signature / issue time).
    // too_fast: valid, but younger than minFormAgeSeconds. NOT spent, so the same payload passes a
    //   moment later.
    // replayed: valid, but already used once.
    | { ok: false; reason: "invalid" | "too_fast" | "replayed" };

type CheckOptions = { minFormAgeSeconds?: number; now?: Date };

// Verifies an ALTCHA payload and spends it, so each solved challenge works exactly once.
export async function checkAltchaPayload(
    payload: string | undefined,
    { minFormAgeSeconds = 0, now = new Date() }: CheckOptions = {},
): Promise<AltchaCheck> {
    const hmacKey = process.env.ALTCHA_HMAC_KEY;
    if (!hmacKey || !payload) return { ok: false, reason: "invalid" };
    const parsed = parseAltchaPayload(payload);
    if (!parsed) return { ok: false, reason: "invalid" };
    const { challenge, solution } = parsed;
    const params = challenge.parameters;

    try {
        // altcha-lib before 2.3.2 didn't check keyPrefix when it re-derived the key
        // (GHSA-rx38-p542-v527), so any counter passed with one derivation and no work. We're on a
        // fixed version, and keep a second layer anyway: only accept challenges issued in
        // deterministic mode, which verifySolution checks against the key signature, and check the
        // prefix ourselves.
        if (!params?.keySignature || typeof params.keyPrefix !== "string" || !params.keyPrefix) {
            return { ok: false, reason: "invalid" };
        }
        if (typeof params.expiresAt !== "number" || typeof params.data?.iat !== "number") {
            return { ok: false, reason: "invalid" };
        }
        const result = await verifySolution({
            challenge,
            deriveKey,
            hmacKeySignatureSecret: keySignatureSecret(hmacKey),
            hmacSignatureSecret: hmacKey,
            solution,
        });
        if (!result.verified) return { ok: false, reason: "invalid" };
        if (
            typeof solution.derivedKey !== "string" ||
            !solution.derivedKey.toLowerCase().startsWith(params.keyPrefix)
        ) {
            return { ok: false, reason: "invalid" };
        }
    } catch (err) {
        console.error("[ALTCHA] verify failed:", err);
        return { ok: false, reason: "invalid" };
    }

    const formAgeMs = now.getTime() - (params.data!.iat as number);
    if (formAgeMs < minFormAgeSeconds * 1000) return { ok: false, reason: "too_fast" };

    // Spend it. The _id is a hash of the challenge signature (unique per challenge: random nonce
    // and salt), kept until the challenge's own expiry; inserting it twice fails with 11000.
    const id = crypto.createHash("sha256").update(String(challenge.signature)).digest("hex");
    try {
        await UsedAltchaChallenges.insertOne({ _id: id, expiresAt: new Date((params.expiresAt as number) * 1000) });
    } catch (err) {
        if ((err as { code?: number })?.code === 11000) return { ok: false, reason: "replayed" };
        // Fail closed: without the store we can't tell a replay from a first use.
        console.error("[ALTCHA] could not record used challenge:", err);
        return { ok: false, reason: "invalid" };
    }

    const solveMs =
        typeof solution.time === "number" && Number.isFinite(solution.time) ? Math.round(solution.time) : null;
    return { ok: true, formAgeSeconds: Math.floor(formAgeMs / 1000), solveMs };
}

export async function verifyAltchaPayload(payload: string | undefined): Promise<boolean> {
    return (await checkAltchaPayload(payload)).ok;
}
