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
    createUserSession: async () => "session",
    getAuthenticatedUserDid: async () => undefined,
    USERS_DIR: "/nonexistent",
}));
mock.module("@/lib/data/user", () => ({ getUserPrivate: async () => ({}) }));
mock.module("next/headers", () => ({ headers: async () => new Headers({ host: "staging.example.test" }) }));

const { requestLoginLinkAction } = await import("./actions");

const GENERIC = "If an account with that email exists, a login link has been sent.";

describe("requestLoginLinkAction email lookup", () => {
    beforeEach(() => {
        postmark.sent.length = 0;
        circles = createFakeCollection([
            { _id: "1", did: "did-lower", email: "lower@example.test", name: "Lower" },
            { _id: "2", did: "did-legacy", email: "Legacy.Mixed@Example.test", name: "Legacy" },
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
