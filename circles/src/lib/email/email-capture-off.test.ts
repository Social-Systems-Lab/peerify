// Run: bun test src/lib/email/email-capture-off.test.ts
// email.ts's default sender with capture mode off and no Postmark token (Cleura staging today, or prod
// with Postmark down): nothing may be captured, and the capture store may not even be loaded. Run this
// file on its own: it needs email.ts to be imported fresh with this environment.

import { afterAll, describe, expect, mock, test } from "bun:test";

const savedEnv = { ...process.env };
delete process.env.EMAIL_CAPTURE_MODE;
delete process.env.POSTMARK_API_TOKEN;
process.env.CIRCLES_URL = "https://peerify.one";
afterAll(() => {
    process.env = savedEnv;
});

const dbCalls: string[] = [];
mock.module("@/lib/data/db", () => ({
    CapturedEmails: new Proxy(
        {},
        {
            get: (_target, prop) => {
                dbCalls.push(String(prop));
                return () => {
                    throw new Error("capturedEmails touched with capture mode off");
                };
            },
        },
    ),
}));
let storeLoaded = false;
mock.module("@/lib/email/captured-emails", () => {
    storeLoaded = true;
    return { storeCapturedEmail: async () => "should-not-happen" };
});

const { trySendEmail, sendEmail } = await import("@/lib/data/email");

describe("capture mode off, Postmark not configured", () => {
    test("returns not_configured; nothing is captured and the store is never loaded", async () => {
        const mail = {
            to: "t0-login-1@example.invalid",
            templateAlias: "password-reset",
            templateModel: { actionUrl: "https://peerify.one/reset-password?token=x" },
        };
        const result = await trySendEmail(mail);
        expect(!result.ok && result.reason).toBe("not_configured");
        expect(await sendEmail(mail)).toEqual(result);
        expect(storeLoaded).toBe(false);
        expect(dbCalls).toEqual([]);
    });
});
