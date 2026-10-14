// Run: bun test src/components/forms/signup/signup-friction.test.ts
// submitSignupFormAction's friction and input checks: the refusal paths before any account is
// created (ALTCHA invalid / replayed / too fast, honeypot), and the metadata whitelist.
// checkAltchaPayload itself is covered in src/lib/auth/altcha.test.ts; here it returns whatever
// the test sets, and account creation, profile updates and circle creation are spies.

import { beforeEach, describe, expect, mock, test } from "bun:test";

type Check =
    | { ok: true; formAgeSeconds: number; solveMs: number | null }
    | { ok: false; reason: "invalid" | "too_fast" | "replayed" };
let altchaResult: Check = { ok: true, formAgeSeconds: 12, solveMs: 900 };
const altchaCalls: { payload?: string; minFormAgeSeconds?: number }[] = [];
mock.module("@/lib/auth/altcha", () => ({
    checkAltchaPayload: async (payload?: string, opts?: { minFormAgeSeconds?: number }) => {
        altchaCalls.push({ payload, minFormAgeSeconds: opts?.minFormAgeSeconds });
        return altchaResult;
    },
    verifyAltchaPayload: async () => altchaResult.ok,
}));

const created: string[] = [];
mock.module("@/lib/auth/auth", () => ({
    AuthenticationError: class AuthenticationError extends Error {},
    createUserAccount: async (_name: string, handle: string) => {
        created.push(handle);
        return { _id: "u1", did: "did:test:u1", handle };
    },
    createUserSession: async () => "session",
}));
const profileUpdates: Record<string, any>[] = [];
const createdCircles: Record<string, any>[] = [];
mock.module("@/lib/data/circle", () => ({
    updateCircle: async (update: Record<string, any>) => {
        profileUpdates.push(update);
    },
    createCircle: async (circle: Record<string, any>) => {
        createdCircles.push(circle);
        return { _id: "c1" };
    },
    getCircleByHandle: async () => null,
}));
mock.module("@/lib/data/member", () => ({ addMember: async () => undefined }));
mock.module("@/lib/data/user", () => ({ getUserPrivate: async () => ({ handle: "jane-doe" }) }));
mock.module("@/lib/data/mongo-chat", () => ({ ensureWelcomeMessageForNewUser: async () => undefined }));
mock.module("@/lib/data/system-message-templates", () => ({
    getResolvedWelcomeTemplate: async () => ({ config: {}, senderDid: "did:test:system" }),
}));
mock.module("@/lib/auth/local-identity", () => ({
    generateLocalDidAndPublicKey: () => ({ did: "did:test:artist" }),
}));

const { submitSignupFormAction } = await import("./actions");
const { SIGNUP_HONEYPOT_FIELD } = await import("./signup-honeypot-field");

const form = (extra: Record<string, unknown> = {}) => ({
    name: "Jane Doe",
    handle: "jane-doe",
    _email: "jane@example.test",
    altcha: "payload",
    [SIGNUP_HONEYPOT_FIELD]: "",
    ...extra,
});

describe("submitSignupFormAction friction", () => {
    beforeEach(() => {
        altchaResult = { ok: true, formAgeSeconds: 12, solveMs: 900 };
        altchaCalls.length = 0;
        created.length = 0;
    });

    test("passes with a valid ALTCHA and an empty honeypot, asking for a 3 s minimum form age", async () => {
        const res = await submitSignupFormAction(form());
        expect(res.success).toBe(true);
        expect(created).toEqual(["jane-doe"]);
        expect(altchaCalls).toEqual([{ payload: "payload", minFormAgeSeconds: 3 }]);
    });

    test("too fast: refused, nothing created, and the form may keep the same solved widget", async () => {
        altchaResult = { ok: false, reason: "too_fast" };
        const res = await submitSignupFormAction(form());
        expect(res.success).toBe(false);
        expect(res.keepAltcha).toBe(true);
        expect(created).toEqual([]);
    });

    test("invalid or replayed: refused with the verification message; the form needs a fresh challenge", async () => {
        for (const reason of ["invalid", "replayed"] as const) {
            altchaResult = { ok: false, reason };
            const res = await submitSignupFormAction(form());
            expect(res.success).toBe(false);
            expect(res.keepAltcha === true).toBe(false);
            expect(res.message).toBe("Please complete the human-verification check.");
        }
        expect(created).toEqual([]);
    });

    test("honeypot filled: refused with a plain message, nothing created", async () => {
        const res = await submitSignupFormAction(form({ [SIGNUP_HONEYPOT_FIELD]: "https://spam.example" }));
        expect(res).toEqual({ success: false, message: "Signup failed. Please try again." });
        expect(created).toEqual([]);
        // The ALTCHA was checked (and spent) first.
        expect(altchaCalls.length).toBe(1);
    });

    test("honeypot with only whitespace or missing counts as empty", async () => {
        expect((await submitSignupFormAction(form({ [SIGNUP_HONEYPOT_FIELD]: "  " }))).success).toBe(true);
        const { [SIGNUP_HONEYPOT_FIELD]: _omit, ...withoutField } = form();
        expect((await submitSignupFormAction(withoutField)).success).toBe(true);
    });

    test("a non-string honeypot value is refused", async () => {
        const res = await submitSignupFormAction(form({ [SIGNUP_HONEYPOT_FIELD]: ["x"] }));
        expect(res.success).toBe(false);
        expect(created).toEqual([]);
    });
});

describe("submitSignupFormAction metadata whitelist", () => {
    beforeEach(() => {
        altchaResult = { ok: true, formAgeSeconds: 12, solveMs: 900 };
        created.length = 0;
        profileUpdates.length = 0;
        createdCircles.length = 0;
    });

    const storedMetadata = () => profileUpdates.at(-1)?.metadata;

    test("keeps only onboardingFlow, signupIntent and bandOrVenueName", async () => {
        const res = await submitSignupFormAction(
            form({
                metadata: {
                    onboardingFlow: "pilot-quick-signup",
                    signupIntent: "artist",
                    bandOrVenueName: "  The Band  ",
                    peerify: { managedIdentity: true, identityType: "producer", intent: "artist" },
                    junk: "x".repeat(10_000),
                },
            }),
        );
        expect(res.success).toBe(true);
        expect(storedMetadata()).toEqual({
            onboardingFlow: "pilot-quick-signup",
            signupIntent: "artist",
            bandOrVenueName: "The Band",
        });
        expect(createdCircles.map((c) => c.name)).toEqual(["The Band"]);
    });

    test("drops values outside the allowed sets", async () => {
        await submitSignupFormAction(
            form({ metadata: { onboardingFlow: "admin", signupIntent: "producer", bandOrVenueName: "X" } }),
        );
        expect(profileUpdates).toEqual([]);
        expect(createdCircles).toEqual([]);
        await submitSignupFormAction(form({ metadata: { signupIntent: "venue" } }));
        expect(profileUpdates).toEqual([]);
    });

    test("bandOrVenueName only with the artist intent, capped at 80 characters", async () => {
        await submitSignupFormAction(form({ metadata: { signupIntent: "fan", bandOrVenueName: "Not Stored" } }));
        expect(storedMetadata()).toEqual({ signupIntent: "fan" });
        expect(createdCircles).toEqual([]);

        await submitSignupFormAction(form({ metadata: { signupIntent: "artist", bandOrVenueName: "a".repeat(200) } }));
        expect(storedMetadata()?.bandOrVenueName).toBe("a".repeat(80));
        expect(createdCircles.at(-1)?.name).toBe("a".repeat(80));
    });

    test("non-object metadata is ignored", async () => {
        for (const metadata of ["onboardingFlow", ["signupIntent"], null, 42]) {
            expect((await submitSignupFormAction(form({ metadata }))).success).toBe(true);
        }
        expect(profileUpdates).toEqual([]);
    });
});
