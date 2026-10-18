// Run: bun test src/lib/email/email-capture.test.ts
// Postmark and the database are mocked; nothing is sent or stored. The environment is set to capture
// mode (with a Postmark token present) before email.ts is first imported, so its default sender is
// the capture one; run this file on its own, as the other test files are.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { installPostmarkMock } from "@/lib/testing/mock-postmark";

const savedEnv = { ...process.env };
process.env.EMAIL_CAPTURE_MODE = "on";
process.env.CIRCLES_URL = "https://cleura-staging.peerify.one";
delete process.env.NEXT_PUBLIC_APP_URL;
delete process.env.APP_URL;
delete process.env.SITE_URL;
delete process.env.NEXT_PUBLIC_SITE_URL;
// A token is set too: capture mode must still never reach Postmark.
const postmark = installPostmarkMock();
afterAll(() => {
    process.env = savedEnv;
});

// A fake capturedEmails collection.
type Stored = Record<string, any>;
const stored: Stored[] = [];
const indexCalls: unknown[] = [];
let failInsert = false;
mock.module("@/lib/data/db", () => ({
    CapturedEmails: {
        createIndex: async (...args: unknown[]) => {
            indexCalls.push(args);
            return "expiresAt_1";
        },
        insertOne: async (doc: Stored) => {
            if (failInsert) throw new Error("not primary (would mention owner@example.test)");
            stored.push(doc);
            return { insertedId: `id${stored.length}` };
        },
        find: (filter: { createdAt: { $gt: Date } }) => {
            let docs = stored.filter((d) => d.createdAt > filter.createdAt.$gt);
            const cursor = {
                sort: () => {
                    docs = [...docs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
                    return cursor;
                },
                limit: (n: number) => {
                    docs = docs.slice(0, n);
                    return cursor;
                },
                toArray: async () => docs,
            };
            return cursor;
        },
    },
}));

const { createEmailSender, sendEmail, trySendEmail } = await import("@/lib/data/email");
const { listCapturedEmails, CAPTURED_EMAIL_TTL_MS } = await import("./captured-emails");

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
const LOGIN_LINK = `https://cleura-staging.peerify.one/login-link?token=${TOKEN}`;
const RESET_LINK = `https://cleura-staging.peerify.one/reset-password?token=${TOKEN}`;
const ADDRESS = "t0-login-1@example.invalid";

// Collects every console line written while fn runs.
const captureLogs = async (fn: () => Promise<unknown>): Promise<string[]> => {
    const lines: string[] = [];
    const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    for (const level of ["log", "warn", "error", "info"] as const) {
        console[level] = (...args: unknown[]) => {
            lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
        };
    }
    try {
        await fn();
    } finally {
        Object.assign(console, original);
    }
    return lines;
};

describe("default sender with EMAIL_CAPTURE_MODE=on", () => {
    beforeEach(() => {
        stored.length = 0;
        postmark.sent.length = 0;
        failInsert = false;
    });

    test("stores the email with the same model Postmark would get, and never calls Postmark", async () => {
        const result = await trySendEmail({
            to: ADDRESS,
            templateAlias: "password-reset",
            templateModel: { name: "T0", actionUrl: RESET_LINK },
        });
        expect(result).toEqual({ ok: true, messageId: "captured:id1" });
        expect(postmark.sent).toHaveLength(0);
        expect(stored).toHaveLength(1);
        expect(stored[0].to).toBe(ADDRESS);
        expect(stored[0].templateAlias).toBe("password-reset");
        expect(stored[0].templateModel.action_url).toBe(RESET_LINK);
        expect(stored[0].templateModel.product_name).toBe("Peerify");
        const ttl = stored[0].expiresAt.getTime() - stored[0].createdAt.getTime();
        expect(ttl).toBe(CAPTURED_EMAIL_TTL_MS);
    });

    test("sendEmail (the throwing variant) captures too", async () => {
        await sendEmail({ to: "hello@socialsystems.io", templateAlias: "contact-form", templateModel: { message: "hi" } });
        expect(stored).toHaveLength(1);
        expect(postmark.sent).toHaveLength(0);
    });

    test("the TTL index is created once, on the first capture", async () => {
        await trySendEmail({ to: ADDRESS, templateAlias: "a", templateModel: {} });
        await trySendEmail({ to: ADDRESS, templateAlias: "b", templateModel: {} });
        expect(indexCalls).toEqual([[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]]);
    });

    test("a failed store is capture_failed: sendEmail throws, Postmark is still not called", async () => {
        failInsert = true;
        const result = await trySendEmail({ to: ADDRESS, templateAlias: "password-reset", templateModel: {} });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.reason).toBe("capture_failed");
        let thrown: unknown;
        try {
            await sendEmail({ to: ADDRESS, templateAlias: "password-reset", templateModel: {} });
        } catch (error) {
            thrown = error;
        }
        expect((thrown as Error)?.message).toContain("Failed to send email");
        expect((thrown as Error)?.message).not.toContain("owner@example.test");
        expect(postmark.sent).toHaveLength(0);
    });

    test("logs name the template and a masked address only: no link, token or full address", async () => {
        const lines = await captureLogs(async () => {
            await trySendEmail({
                to: ADDRESS,
                templateAlias: "email-verification",
                templateModel: { name: "T0", actionUrl: LOGIN_LINK, actionText: "Log in" },
            });
            await trySendEmail({ to: ADDRESS, templateAlias: "password-reset", templateModel: { actionUrl: RESET_LINK } });
            failInsert = true;
            await trySendEmail({ to: ADDRESS, templateAlias: "password-reset", templateModel: { actionUrl: RESET_LINK } });
        });
        expect(lines).toContain("Email captured (template email-verification) for t***@example.invalid");
        const all = lines.join("\n");
        for (const secret of [TOKEN, "token=", "/login-link", "/reset-password", ADDRESS]) {
            expect(all).not.toContain(secret);
        }
    });

    test("listCapturedEmails: newest first, only the last 24 h, at most 50", async () => {
        const now = new Date();
        for (let i = 0; i < 55; i++) {
            stored.push({ to: ADDRESS, templateAlias: `t${i}`, templateModel: {}, createdAt: new Date(now.getTime() - i * 1000) });
        }
        stored.push({ to: ADDRESS, templateAlias: "old", templateModel: {}, createdAt: new Date(now.getTime() - CAPTURED_EMAIL_TTL_MS - 1) });
        const list = await listCapturedEmails(now);
        expect(list).toHaveLength(50);
        expect(list[0].templateAlias).toBe("t0");
        expect(list.map((d) => d.templateAlias)).not.toContain("old");
    });
});

describe("createEmailSender: capture versus normal sending", () => {
    const makeClient = (fail = false) => {
        const calls: unknown[] = [];
        return {
            calls,
            client: {
                sendEmailWithTemplate: async (message: unknown) => {
                    calls.push(message);
                    if (fail) throw new Error("Postmark down");
                    return { MessageID: "pm-1" } as never;
                },
            },
        };
    };
    const makeCapture = (mode: "on" | "refused" = "on") => {
        const captured: unknown[] = [];
        return {
            captured,
            capture: {
                check: () => (mode === "on" ? { mode: "on" as const } : { mode: "refused" as const, reason: "test" }),
                store: async (email: unknown) => {
                    captured.push(email);
                    return "x1";
                },
            },
        };
    };
    const MAIL = { to: ADDRESS, templateAlias: "password-reset", templateModel: { actionUrl: RESET_LINK } };

    test("without capture, Postmark is called exactly as before and nothing is stored", async () => {
        const { client, calls } = makeClient();
        const sender = createEmailSender(client, "no-reply@example.test");
        expect(await sender.trySendEmail(MAIL)).toEqual({ ok: true, messageId: "pm-1" });
        expect(calls).toHaveLength(1);
    });

    test("with capture, a client that is present is never called", async () => {
        const { client, calls } = makeClient();
        const { capture, captured } = makeCapture();
        const sender = createEmailSender(client, "no-reply@example.test", capture);
        expect(await sender.trySendEmail(MAIL)).toEqual({ ok: true, messageId: "captured:x1" });
        expect(calls).toHaveLength(0);
        expect(captured).toHaveLength(1);
    });

    test("Postmark missing or failing never switches to capture", async () => {
        const missing = createEmailSender(null, "no-reply@example.test");
        const result = await missing.trySendEmail(MAIL);
        expect(!result.ok && result.reason).toBe("not_configured");

        const { client } = makeClient(true);
        const failing = createEmailSender(client, "no-reply@example.test");
        const failed = await failing.trySendEmail(MAIL);
        expect(!failed.ok && failed.reason).toBe("send_failed");
        // Both senders have no capture at all, so there is nowhere a capture could happen.
    });

    test("a refused setting at send time captures nothing and sends nothing", async () => {
        const { client, calls } = makeClient();
        const { capture, captured } = makeCapture("refused");
        const sender = createEmailSender(client, "no-reply@example.test", capture);
        const result = await sender.trySendEmail(MAIL);
        expect(!result.ok && result.reason).toBe("capture_refused");
        expect(await sender.sendEmail(MAIL)).toEqual(result); // returned, not thrown, like not_configured
        expect(calls).toHaveLength(0);
        expect(captured).toHaveLength(0);
    });
});
