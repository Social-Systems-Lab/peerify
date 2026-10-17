// Run: bun test src/components/forms/login/password-login.test.ts
// The database and session layer are mocked; key files are not touched (authenticateUser is mocked
// here; key-file.test.ts covers the real check).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeCollection, type FakeCollection } from "@/lib/testing/fake-collection";

let circles: FakeCollection = createFakeCollection();

class AuthenticationError extends Error {}
// Which DID/password pairs authenticate; anything else throws like the real check.
let validPasswords: Record<string, string> = {};
let missingKeyFiles = new Set<string>();
const authenticateCalls: string[] = [];
let burnCalls = 0;
const sessions: string[] = [];

mock.module("@/lib/data/db", () => ({
    Circles: {
        findOne: (...args: Parameters<FakeCollection["findOne"]>) => circles.findOne(...args),
        updateOne: (...args: Parameters<FakeCollection["updateOne"]>) => circles.updateOne(...args),
    },
}));
// bun's module mocks are process-wide, so this exposes everything any test file's subject
// imports from auth.ts (login-link.test.ts and resend.test.ts mock the same module).
mock.module("@/lib/auth/auth", () => ({
    AuthenticationError,
    authenticateUser: (did: string, password: string) => {
        authenticateCalls.push(did);
        if (missingKeyFiles.has(did)) throw new AuthenticationError("Account credentials missing");
        if (validPasswords[did] !== password) throw new AuthenticationError("Incorrect password");
        return true;
    },
    burnPasswordCheck: () => {
        burnCalls++;
    },
    createUserSession: async (_user: unknown, did: string) => {
        sessions.push(did);
        return "session";
    },
    getAuthenticatedUserDid: async () => undefined,
    USERS_DIR: "/nonexistent",
}));
mock.module("@/lib/data/user", () => ({ getUserPrivate: async (did: string) => ({ did, handle: "h" }) }));
mock.module("next/headers", () => ({
    headers: async () =>
        new Headers({
            host: "staging.example.test",
            "x-real-ip": "203.0.113.7",
            // Client-supplied; must never become the limit key.
            "x-forwarded-for": "198.51.100.66",
        }),
}));
const ALTCHA_OK = "solved-challenge";
mock.module("@/lib/auth/altcha", () => ({ verifyAltchaPayload: async (payload?: string) => payload === ALTCHA_OK }));
// The real limiter needs MongoDB's upsert; here each key is allowed or refused on demand.
const ipClaims: { key: string; seconds: number }[] = [];
let ipLimited = false;
mock.module("@/lib/data/rate-limit", () => ({
    rateLimitKey: (scope: string, value: string) => `${scope}:${value}`,
    claimMinimumWait: async (key: string, seconds: number) => {
        ipClaims.push({ key, seconds });
        return ipLimited ? { allowed: false, retryAfterSeconds: 4 } : { allowed: true };
    },
}));

const { submitLoginFormAction: submitWithValues } = await import("./actions");
const submitLoginFormAction = (values: Record<string, unknown>) => submitWithValues({ altcha: ALTCHA_OK, ...values });

const GENERIC = "Email or password is incorrect";

describe("submitLoginFormAction: one generic error, equal work", () => {
    beforeEach(() => {
        circles = createFakeCollection([
            { _id: "1", did: "did-a", email: "a@example.test", name: "A" },
            { _id: "2", did: "did-broken", email: "broken@example.test", name: "B" },
            { _id: "3", email: "nodid@example.test", name: "C" },
        ]);
        validPasswords = { "did-a": "right password" };
        missingKeyFiles = new Set(["did-broken"]);
        authenticateCalls.length = 0;
        burnCalls = 0;
        sessions.length = 0;
        ipClaims.length = 0;
        ipLimited = false;
    });

    test("the right password logs in", async () => {
        const result = await submitLoginFormAction({ email: "a@example.test", password: "right password" });
        expect(result.success).toBe(true);
        expect(sessions).toEqual(["did-a"]);
    });

    test("wrong password, unknown address and missing key files all get the same reply", async () => {
        const replies = [
            await submitLoginFormAction({ email: "a@example.test", password: "wrong" }),
            await submitLoginFormAction({ email: "nobody@example.test", password: "wrong" }),
            await submitLoginFormAction({ email: "broken@example.test", password: "wrong" }),
            await submitLoginFormAction({ email: "nodid@example.test", password: "wrong" }),
        ];
        for (const reply of replies) {
            expect(reply).toEqual({ success: false, message: GENERIC });
        }
        expect(sessions).toEqual([]);
    });

    test("an unknown address runs the dummy key derivation instead of a real check", async () => {
        await submitLoginFormAction({ email: "nobody@example.test", password: "x" });
        expect(burnCalls).toBe(1);
        expect(authenticateCalls).toEqual([]);
    });

    test("an account without a DID is treated as unknown", async () => {
        await submitLoginFormAction({ email: "nodid@example.test", password: "x" });
        expect(burnCalls).toBe(1);
        expect(authenticateCalls).toEqual([]);
    });

    test("a known address runs the real check, not the dummy", async () => {
        await submitLoginFormAction({ email: "a@example.test", password: "wrong" });
        expect(authenticateCalls).toEqual(["did-a"]);
        expect(burnCalls).toBe(0);
    });

    test("known and unknown addresses each run exactly one query (no regex fallback)", async () => {
        await submitLoginFormAction({ email: "nobody@example.test", password: "x" });
        expect(circles.queries).toHaveLength(1);
        await submitLoginFormAction({ email: "a@example.test", password: "x" });
        expect(circles.queries).toHaveLength(2);
        expect(JSON.stringify(circles.queries)).not.toContain("$regex");
    });

    test("a non-string password is refused like a wrong one", async () => {
        const result = await submitLoginFormAction({ email: "a@example.test", password: { $ne: "" } });
        expect(result).toEqual({ success: false, message: GENERIC });
    });
});

describe("submitLoginFormAction: ALTCHA and per-IP wait", () => {
    beforeEach(() => {
        circles = createFakeCollection([{ _id: "1", did: "did-a", email: "a@example.test", name: "A" }]);
        validPasswords = { "did-a": "right password" };
        missingKeyFiles = new Set();
        authenticateCalls.length = 0;
        burnCalls = 0;
        sessions.length = 0;
        ipClaims.length = 0;
        ipLimited = false;
    });

    test("a missing or wrong ALTCHA payload is refused before anything else", async () => {
        for (const altcha of [undefined, "", "forged"]) {
            const result = await submitLoginFormAction({ email: "a@example.test", password: "right password", altcha });
            expect(result).toEqual({ success: false, message: "Please complete the human-verification check." });
        }
        expect(ipClaims).toHaveLength(0);
        expect(circles.queries).toHaveLength(0);
        expect(sessions).toEqual([]);
    });

    test("each attempt claims a 5 s wait keyed on the real client IP", async () => {
        await submitLoginFormAction({ email: "a@example.test", password: "wrong" });
        expect(ipClaims).toEqual([{ key: "login-password:ip:203.0.113.7", seconds: 5 }]);
    });

    test("inside the wait, the password is not checked", async () => {
        ipLimited = true;
        const result = await submitLoginFormAction({ email: "a@example.test", password: "right password" });
        expect(result).toEqual({ success: false, message: "Please wait 4 seconds before trying again." });
        expect(circles.queries).toHaveLength(0);
        expect(authenticateCalls).toEqual([]);
        expect(burnCalls).toBe(0);
        expect(sessions).toEqual([]);
    });

    test("an empty or overlong password is refused without spending the ALTCHA or the IP wait", async () => {
        for (const password of ["", "x".repeat(1025)]) {
            const result = await submitLoginFormAction({ email: "a@example.test", password });
            expect(result).toEqual({ success: false, message: GENERIC });
        }
        expect(ipClaims).toHaveLength(0);
        expect(circles.queries).toHaveLength(0);
    });
});
