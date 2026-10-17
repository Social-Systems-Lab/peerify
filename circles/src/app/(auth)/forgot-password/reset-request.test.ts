// Run: bun test "src/app/(auth)/forgot-password/reset-request.test.ts"
// The database, ALTCHA, rate limiter and Postmark client are all mocked; nothing is sent.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeCollection, type FakeCollection } from "@/lib/testing/fake-collection";
import { installPostmarkMock } from "@/lib/testing/mock-postmark";

const postmark = installPostmarkMock();
process.env.CIRCLES_URL = "https://staging.example.test";
let circles: FakeCollection = createFakeCollection();

mock.module("@/lib/data/db", () => ({
    Circles: {
        findOne: (...args: Parameters<FakeCollection["findOne"]>) => circles.findOne(...args),
        updateOne: (...args: Parameters<FakeCollection["updateOne"]>) => circles.updateOne(...args),
        findOneAndUpdate: (...args: Parameters<FakeCollection["findOneAndUpdate"]>) => circles.findOneAndUpdate(...args),
    },
}));
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
// bun's module mocks are process-wide, so this exposes everything any test file's subject imports
// from rate-limit.ts (login-link.test.ts and password-login.test.ts mock the same module).
const ipClaims: { key: string; seconds: number }[] = [];
let ipLimited = false;
mock.module("@/lib/data/rate-limit", () => ({
    rateLimitKey: (scope: string, value: string) => `${scope}:${value}`,
    claimMinimumWait: async (key: string, seconds: number) => {
        ipClaims.push({ key, seconds });
        return ipLimited ? { allowed: false, retryAfterSeconds: 12 } : { allowed: true };
    },
    checkFailureDelay: async () => ({ allowed: true }),
    recordFailure: async () => ({ failures: 1 }),
    clearFailures: async () => undefined,
}));

const { requestPasswordResetAction: requestWithAltcha } = await import("./actions");
const requestPasswordResetAction = (email: string) => requestWithAltcha(email, ALTCHA_OK);

const GENERIC = "If an account with that email exists and is verified, a password reset link has been sent.";
const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);

describe("requestPasswordResetAction", () => {
    beforeEach(() => {
        postmark.sent.length = 0;
        postmark.failNext = null;
        ipClaims.length = 0;
        ipLimited = false;
        circles = createFakeCollection([
            { _id: "1", did: "did-verified", email: "owner@example.test", name: "Owner", isEmailVerified: true },
            { _id: "2", did: "did-unverified", email: "victim@example.test", name: "Xk", isEmailVerified: false },
        ]);
    });

    test("a verified address gets one reset link with a 1-hour token", async () => {
        expect(await requestPasswordResetAction("Owner@Example.test")).toEqual({ success: true, message: GENERIC });
        expect(postmark.sent).toHaveLength(1);
        expect(postmark.sent[0].templateAlias).toBe("password-reset");
        expect(postmark.sent[0].templateModel.actionUrl).toContain("staging.example.test/reset-password?token=");
        const doc = circles.docs[0];
        expect(doc.passwordResetToken).toBeString();
        expect(doc.passwordResetSendCount24h).toBe(1);
        const ttl = doc.passwordResetTokenExpiry.getTime() - Date.now();
        expect(ttl).toBeGreaterThan(3590 * 1000);
        expect(ttl).toBeLessThanOrEqual(3600 * 1000);
    });

    test("unknown and unverified addresses get the same reply and no mail", async () => {
        expect(await requestPasswordResetAction("nobody@example.test")).toEqual({ success: true, message: GENERIC });
        expect(await requestPasswordResetAction("victim@example.test")).toEqual({ success: true, message: GENERIC });
        expect(postmark.sent).toHaveLength(0);
        expect(circles.docs[1].passwordResetToken).toBeUndefined();
    });

    test("a second request within 60 s gets the same reply but no mail and no new token", async () => {
        await requestPasswordResetAction("owner@example.test");
        const firstToken = circles.docs[0].passwordResetToken;
        expect(await requestPasswordResetAction("owner@example.test")).toEqual({ success: true, message: GENERIC });
        expect(postmark.sent).toHaveLength(1);
        expect(circles.docs[0].passwordResetToken).toBe(firstToken);
    });

    test("after the cooldown another link is sent, up to 5 per 24 h", async () => {
        circles.docs[0].passwordResetLastSentAt = secondsAgo(61);
        circles.docs[0].passwordResetSendWindowStart = secondsAgo(3600);
        circles.docs[0].passwordResetSendCount24h = 4;
        await requestPasswordResetAction("owner@example.test");
        expect(postmark.sent).toHaveLength(1);
        expect(circles.docs[0].passwordResetSendCount24h).toBe(5);

        circles.docs[0].passwordResetLastSentAt = secondsAgo(61);
        expect(await requestPasswordResetAction("owner@example.test")).toEqual({ success: true, message: GENERIC });
        expect(postmark.sent).toHaveLength(1);
    });

    test("two concurrent requests send one mail", async () => {
        await Promise.all([
            requestPasswordResetAction("owner@example.test"),
            requestPasswordResetAction("owner@example.test"),
        ]);
        expect(postmark.sent).toHaveLength(1);
    });

    test("a missing or wrong ALTCHA payload is refused before the lookup", async () => {
        for (const altcha of [undefined, "", "forged"]) {
            expect(await requestWithAltcha("owner@example.test", altcha)).toEqual({
                success: false,
                message: "Please complete the human-verification check.",
            });
        }
        expect(ipClaims).toHaveLength(0);
        expect(circles.queries).toHaveLength(0);
        expect(postmark.sent).toHaveLength(0);
    });

    test("each request claims a 20 s wait on the real client IP; inside it nothing is looked up", async () => {
        await requestPasswordResetAction("owner@example.test");
        expect(ipClaims).toEqual([{ key: "password-reset:ip:203.0.113.7", seconds: 20 }]);
        ipLimited = true;
        expect(await requestPasswordResetAction("owner@example.test")).toEqual({
            success: false,
            message: "Please wait 12 seconds before requesting another reset link.",
        });
        expect(circles.queries).toHaveLength(1);
        expect(postmark.sent).toHaveLength(1);
    });

    // email.ts creates its client at load, so "Postmark unset" (not_configured) can't be switched
    // on here; a failing send takes the same path: trySendEmail returns instead of throwing.
    test("a failed send still gives the same reply and keeps the token", async () => {
        postmark.failNext = new Error("boom");
        expect(await requestPasswordResetAction("owner@example.test")).toEqual({ success: true, message: GENERIC });
        expect(postmark.sent).toHaveLength(0);
        expect(circles.docs[0].passwordResetToken).toBeString();
    });
});
