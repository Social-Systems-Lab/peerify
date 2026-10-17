// Run: bun test src/components/forms/login/login-link.test.ts
// The database, session layer and Postmark client are all mocked; nothing is sent.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeCollection, type FakeCollection } from "@/lib/testing/fake-collection";
import { installPostmarkMock } from "@/lib/testing/mock-postmark";

const postmark = installPostmarkMock();
let circles: FakeCollection = createFakeCollection();

mock.module("@/lib/data/db", () => ({
    Circles: {
        findOne: (...args: Parameters<FakeCollection["findOne"]>) => circles.findOne(...args),
        updateOne: (...args: Parameters<FakeCollection["updateOne"]>) => circles.updateOne(...args),
    },
}));
// bun's module mocks are process-wide, so this exposes everything any test file's subject
// imports from auth.ts (resend.test.ts mocks the same module).
mock.module("@/lib/auth/auth", () => ({
    AuthenticationError: class AuthenticationError extends Error {},
    authenticateUser: () => undefined,
    burnPasswordCheck: () => undefined,
    createUserSession: async () => "session",
    getAuthenticatedUserDid: async () => undefined,
    USERS_DIR: "/nonexistent",
}));
mock.module("@/lib/data/user", () => ({ getUserPrivate: async () => ({}) }));
mock.module("next/headers", () => ({
    headers: async () =>
        new Headers({
            host: "staging.example.test",
            "x-real-ip": "203.0.113.7",
            // Client-supplied; must never become the limit key.
            "x-forwarded-for": "198.51.100.66",
        }),
}));
mock.module("@/lib/auth/altcha", () => ({ verifyAltchaPayload: async (payload?: string) => payload === ALTCHA_OK }));
// The real limiter needs MongoDB's upsert; here each key is allowed or refused on demand.
const ipClaims: string[] = [];
let ipLimited = false;
mock.module("@/lib/data/rate-limit", () => ({
    rateLimitKey: (scope: string, value: string) => `${scope}:${value}`,
    claimMinimumWait: async (key: string) => {
        ipClaims.push(key);
        return ipLimited ? { allowed: false, retryAfterSeconds: 12 } : { allowed: true };
    },
}));

const ALTCHA_OK = "solved-challenge";
const { requestLoginLinkAction: requestWithAltcha } = await import("./actions");
const requestLoginLinkAction = (email: string) => requestWithAltcha(email, ALTCHA_OK);

const GENERIC =
    "If a verified account uses that email address, a login link is on its way. Not verified yet? Use the link in your signup email.";
const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);

describe("requestLoginLinkAction email lookup", () => {
    beforeEach(() => {
        postmark.sent.length = 0;
        ipClaims.length = 0;
        ipLimited = false;
        circles = createFakeCollection([
            { _id: "1", did: "did-lower", email: "lower@example.test", name: "Lower", isEmailVerified: true },
            {
                _id: "2",
                did: "did-legacy",
                email: "Legacy.Mixed@Example.test",
                name: "Legacy",
                isEmailVerified: true,
            },
            { _id: "3", did: "did-unverified", email: "bot-victim@example.test", name: "Xk", isEmailVerified: false },
        ]);
    });

    test("mixed-case input matches a lowercase-stored address", async () => {
        const result = await requestLoginLinkAction("Lower@Example.TEST");
        expect(result).toEqual({ success: true, message: GENERIC });
        expect(postmark.sent).toHaveLength(1);
        expect(postmark.sent[0].to).toBe("lower@example.test");
        expect(circles.docs[0].loginLinkToken).toBeString();
    });

    test("surrounding whitespace is trimmed", async () => {
        await requestLoginLinkAction("  lower@example.test  ");
        expect(postmark.sent).toHaveLength(1);
    });

    test("a legacy mixed-case record still matches when typed as stored", async () => {
        await requestLoginLinkAction("Legacy.Mixed@Example.test");
        expect(postmark.sent).toHaveLength(1);
        expect(postmark.sent[0].to).toBe("Legacy.Mixed@Example.test");
    });

    test("queries with exact $in values, never a regex", async () => {
        await requestLoginLinkAction("Lower@Example.TEST");
        expect(circles.queries.at(-1)).toEqual({ email: { $in: ["Lower@Example.TEST", "lower@example.test"] } });
    });

    test("unknown address gets the same generic response and no email", async () => {
        const result = await requestLoginLinkAction("nobody@example.test");
        expect(result).toEqual({ success: true, message: GENERIC });
        expect(postmark.sent).toHaveLength(0);
    });

    test("a Postmark failure still returns the generic response", async () => {
        postmark.failNext = new Error("boom");
        const result = await requestLoginLinkAction("lower@example.test");
        expect(result).toEqual({ success: true, message: GENERIC });
    });
});

describe("requestLoginLinkAction limits", () => {
    beforeEach(() => {
        postmark.sent.length = 0;
        ipClaims.length = 0;
        ipLimited = false;
        circles = createFakeCollection([
            { _id: "1", did: "did-lower", email: "lower@example.test", name: "Lower", isEmailVerified: true },
            { _id: "3", did: "did-unverified", email: "bot-victim@example.test", name: "Xk", isEmailVerified: false },
        ]);
    });

    test("an unverified account gets the generic response and no email", async () => {
        const result = await requestLoginLinkAction("bot-victim@example.test");
        expect(result).toEqual({ success: true, message: GENERIC });
        expect(postmark.sent).toHaveLength(0);
        expect(circles.docs[1].loginLinkToken).toBe(undefined);
    });

    test("without a solved ALTCHA nothing is looked up or sent", async () => {
        const result = await requestWithAltcha("lower@example.test", undefined);
        expect(result).toEqual({ success: false, message: "Please complete the human-verification check." });
        expect(circles.queries).toHaveLength(0);
        expect(ipClaims).toHaveLength(0);
        expect(postmark.sent).toHaveLength(0);
    });

    test("a wrong ALTCHA payload is refused", async () => {
        const result = await requestWithAltcha("lower@example.test", "forged");
        expect(result.success).toBe(false);
        expect(postmark.sent).toHaveLength(0);
    });

    test("the per-IP wait is keyed on the X-Real-IP address", async () => {
        await requestLoginLinkAction("lower@example.test");
        expect(ipClaims).toEqual(["login-link:ip:203.0.113.7"]);
    });

    test("an IP inside its wait gets a wait message, before any account lookup", async () => {
        ipLimited = true;
        const result = await requestLoginLinkAction("lower@example.test");
        expect(result).toEqual({
            success: false,
            message: "Please wait 12 seconds before requesting another login link.",
        });
        expect(circles.queries).toHaveLength(0);
        expect(postmark.sent).toHaveLength(0);
    });

    test("a second request inside the account cooldown sends nothing and looks the same", async () => {
        await requestLoginLinkAction("lower@example.test");
        const firstToken = circles.docs[0].loginLinkToken;
        const second = await requestLoginLinkAction("lower@example.test");
        expect(second).toEqual({ success: true, message: GENERIC });
        expect(postmark.sent).toHaveLength(1);
        // The first link keeps working.
        expect(circles.docs[0].loginLinkToken).toBe(firstToken);
    });

    test("allowed again once the cooldown has passed, and the count is persisted", async () => {
        await requestLoginLinkAction("lower@example.test");
        circles.docs[0].loginLinkLastSentAt = secondsAgo(61);
        await requestLoginLinkAction("lower@example.test");
        expect(postmark.sent).toHaveLength(2);
        expect(circles.docs[0].loginLinkSendCount24h).toBe(2);
    });

    test("the daily cap stops the 6th link in the window", async () => {
        Object.assign(circles.docs[0], {
            loginLinkLastSentAt: secondsAgo(120),
            loginLinkSendWindowStart: secondsAgo(3600),
            loginLinkSendCount24h: 5,
        });
        const result = await requestLoginLinkAction("lower@example.test");
        expect(result).toEqual({ success: true, message: GENERIC });
        expect(postmark.sent).toHaveLength(0);
    });

    test("the cap resets after 24 hours", async () => {
        Object.assign(circles.docs[0], {
            loginLinkLastSentAt: secondsAgo(25 * 3600),
            loginLinkSendWindowStart: secondsAgo(25 * 3600),
            loginLinkSendCount24h: 5,
        });
        await requestLoginLinkAction("lower@example.test");
        expect(postmark.sent).toHaveLength(1);
        expect(circles.docs[0].loginLinkSendCount24h).toBe(1);
    });

    test("log lines never contain the full address", async () => {
        const lines: string[] = [];
        const original = { log: console.log, error: console.error };
        console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
        console.error = console.log;
        try {
            await requestLoginLinkAction("nobody-here@example.test");
            await requestLoginLinkAction("bot-victim@example.test");
            await requestLoginLinkAction("lower@example.test");
        } finally {
            console.log = original.log;
            console.error = original.error;
        }
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            expect(/nobody-here@|bot-victim@|lower@/.test(line)).toBe(false);
        }
        expect(lines.join("\n")).toContain("n***@example.test");
    });
});
