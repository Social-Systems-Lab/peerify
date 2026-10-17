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
    headers: async () => new Headers({ host: "staging.example.test", "x-real-ip": "203.0.113.7" }),
}));
mock.module("@/lib/auth/altcha", () => ({ verifyAltchaPayload: async () => true }));
mock.module("@/lib/data/rate-limit", () => ({
    rateLimitKey: (scope: string, value: string) => `${scope}:${value}`,
    claimMinimumWait: async () => ({ allowed: true }),
}));

const { submitLoginFormAction } = await import("./actions");

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
