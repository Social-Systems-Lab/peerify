// Run: bun test src/lib/email/captured-emails-admin.test.ts
// The session, user lookup and capture store are mocked; capture mode is switched through the
// environment (capture-mode.ts reads it on every check).

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const savedEnv = { ...process.env };
afterAll(() => {
    process.env = savedEnv;
});
const setCapture = (on: boolean) => {
    process.env.CIRCLES_URL = on ? "https://cleura-staging.peerify.one" : "https://peerify.one";
    if (on) process.env.EMAIL_CAPTURE_MODE = "on";
    else delete process.env.EMAIL_CAPTURE_MODE;
    for (const name of ["NEXT_PUBLIC_APP_URL", "APP_URL", "SITE_URL", "NEXT_PUBLIC_SITE_URL"]) delete process.env[name];
};

let sessionDid: string | undefined;
let sessionThrows = false;
const sessionCalls: number[] = [];
let users: Record<string, { isAdmin?: boolean }> = {};
const userCalls: string[] = [];
let listCalls = 0;
let storedDocs: Record<string, any>[] = [];

// bun's module mocks are process-wide, so this exposes what other test files' subjects import too.
mock.module("@/lib/auth/auth", () => ({
    AuthenticationError: class AuthenticationError extends Error {},
    authenticateUser: () => undefined,
    burnPasswordCheck: () => undefined,
    createUserSession: async () => "session",
    USERS_DIR: "/nonexistent",
    getAuthenticatedUserDid: async () => {
        sessionCalls.push(1);
        if (sessionThrows) throw new Error("invalid token");
        return sessionDid;
    },
}));
mock.module("@/lib/data/user", () => ({
    getUserPrivate: async (did: string) => {
        userCalls.push(did);
        if (!users[did]) throw new Error("User not found");
        return users[did];
    },
}));
mock.module("./captured-emails", () => ({
    listCapturedEmails: async () => {
        listCalls++;
        return storedDocs;
    },
}));

const { loadCapturedEmailsPage, linksInModel } = await import("./captured-emails-admin");

describe("loadCapturedEmailsPage", () => {
    beforeEach(() => {
        setCapture(true);
        sessionDid = "did-admin";
        sessionThrows = false;
        sessionCalls.length = 0;
        users = { "did-admin": { isAdmin: true }, "did-user": { isAdmin: false } };
        userCalls.length = 0;
        listCalls = 0;
        storedDocs = [
            {
                _id: "e1",
                to: "t0-login-1@example.invalid",
                templateAlias: "password-reset",
                createdAt: new Date("2026-10-18T07:41:12Z"),
                templateModel: { action_url: "https://cleura-staging.peerify.one/reset-password?token=abc", name: "T0" },
            },
        ];
    });

    test("capture mode off: not found, before any session, user or database access", async () => {
        setCapture(false);
        expect(await loadCapturedEmailsPage()).toEqual({ status: "not_found" });
        expect(sessionCalls).toHaveLength(0);
        expect(userCalls).toHaveLength(0);
        expect(listCalls).toBe(0);
    });

    test("capture mode on but refused (prod URL): not found", async () => {
        process.env.EMAIL_CAPTURE_MODE = "on";
        process.env.CIRCLES_URL = "https://peerify.one";
        expect(await loadCapturedEmailsPage()).toEqual({ status: "not_found" });
        expect(sessionCalls).toHaveLength(0);
    });

    test("logged out, invalid session, unknown user or non-admin: not found, and the list is never read", async () => {
        sessionDid = undefined;
        expect(await loadCapturedEmailsPage()).toEqual({ status: "not_found" });
        sessionDid = "did-admin";
        sessionThrows = true;
        expect(await loadCapturedEmailsPage()).toEqual({ status: "not_found" });
        sessionThrows = false;
        sessionDid = "did-nobody";
        expect(await loadCapturedEmailsPage()).toEqual({ status: "not_found" });
        sessionDid = "did-user";
        expect(await loadCapturedEmailsPage()).toEqual({ status: "not_found" });
        expect(listCalls).toBe(0);
    });

    test("admin with capture on: the list, with the action link and the model as text", async () => {
        const data = await loadCapturedEmailsPage();
        expect(data.status).toBe("ok");
        if (data.status !== "ok") return;
        expect(data.emails).toHaveLength(1);
        expect(data.emails[0]).toEqual({
            id: "e1",
            to: "t0-login-1@example.invalid",
            templateAlias: "password-reset",
            createdAt: "2026-10-18T07:41:12.000Z",
            links: ["https://cleura-staging.peerify.one/reset-password?token=abc"],
            modelJson: JSON.stringify(storedDocs[0].templateModel, null, 2),
        });
    });
});

describe("linksInModel", () => {
    test("action link first, then other http(s) URLs, nested ones too, without duplicates", () => {
        expect(
            linksInModel({
                product_url: "https://cleura-staging.peerify.one",
                action_url: "https://cleura-staging.peerify.one/login-link?token=t",
                notifications: ["see https://x.example inside text", "https://cleura-staging.peerify.one/chat"],
                nested: { support_url: "https://cleura-staging.peerify.one/support" },
                again: "https://cleura-staging.peerify.one",
            }),
        ).toEqual([
            "https://cleura-staging.peerify.one/login-link?token=t",
            "https://cleura-staging.peerify.one",
            "https://cleura-staging.peerify.one/chat",
            "https://cleura-staging.peerify.one/support",
        ]);
    });

    test("nothing but http(s) becomes a link", () => {
        expect(
            linksInModel({
                action_url: "javascript:alert(1)",
                a: "data:text/html,<b>x</b>",
                b: "mailto:hello@socialsystems.io",
                c: "ftp://example.test/file",
                d: "<a href='https://x.example'>",
            }),
        ).toEqual([]);
    });
});
