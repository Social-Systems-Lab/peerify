// Run: bun test "src/app/(auth)/verify-email/resend.test.ts"
// The database, session layer and Postmark client are all mocked; nothing is sent.

import crypto from "crypto";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createFakeCollection, type FakeCollection } from "@/lib/testing/fake-collection";
import { installPostmarkMock } from "@/lib/testing/mock-postmark";
import {
    evaluateVerificationResend,
    VERIFICATION_RESEND_COOLDOWN_SECONDS,
    VERIFICATION_RESEND_DAILY_CAP,
} from "@/lib/auth/verification-email";

const postmark = installPostmarkMock();
process.env.CIRCLES_URL = "https://staging.example.test";

let circles: FakeCollection = createFakeCollection();
let sessionDid: string | undefined;
let sessionThrows = false;

mock.module("@/lib/data/db", () => ({
    Circles: {
        findOne: (...args: Parameters<FakeCollection["findOne"]>) => circles.findOne(...args),
        updateOne: (...args: Parameters<FakeCollection["updateOne"]>) => circles.updateOne(...args),
    },
}));
mock.module("@/lib/auth/auth", () => ({
    getAuthenticatedUserDid: async () => {
        if (sessionThrows) {
            throw new Error("invalid token");
        }
        return sessionDid;
    },
    createUserSession: async () => "session",
}));
mock.module("@/lib/data/user", () => ({ getUserPrivate: async () => ({}) }));
mock.module("@/lib/data/circle", () => ({
    getAutoProvisionedArtistCircle: async () => null,
    getCirclePublishStatus: () => "published",
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));

const { resendVerificationEmailAction, getVerificationResendStatusAction, verifyEmailAction } = await import(
    "./actions"
);

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);
const OLD_TOKEN = "old-token-value";
const STORED_EMAIL = "owner@example.test";

const seedUser = (overrides: Record<string, unknown> = {}) => {
    circles = createFakeCollection([
        {
            _id: "u1",
            did: "did-owner",
            handle: "owner",
            name: "Owner",
            email: STORED_EMAIL,
            isEmailVerified: false,
            emailVerificationToken: sha256(OLD_TOKEN),
            emailVerificationTokenExpiry: new Date(Date.now() + 3600 * 1000),
            emailVerificationLastSentAt: secondsAgo(VERIFICATION_RESEND_COOLDOWN_SECONDS + 5),
            ...overrides,
        },
    ]);
    return circles.docs[0];
};

const tokenFromLastEmail = () => {
    const url = new URL(postmark.sent.at(-1)!.templateModel.actionUrl);
    return url.searchParams.get("token")!;
};

beforeEach(() => {
    postmark.sent.length = 0;
    postmark.failNext = null;
    sessionDid = "did-owner";
    sessionThrows = false;
});

describe("evaluateVerificationResend", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const at = (msAgo: number) => new Date(now.getTime() - msAgo);

    test("first resend with no history is allowed and opens a window", () => {
        expect(evaluateVerificationResend({}, now)).toEqual({ allowed: true, windowStart: now, sendCount: 1 });
    });

    test("cooldown reports the seconds remaining", () => {
        expect(evaluateVerificationResend({ emailVerificationLastSentAt: at(15_000) }, now)).toEqual({
            allowed: false,
            reason: "cooldown",
            retryAfterSeconds: 45,
        });
    });

    test("allowed once the cooldown has passed", () => {
        expect(evaluateVerificationResend({ emailVerificationLastSentAt: at(60_000) }, now).allowed).toBe(true);
    });

    test("daily cap blocks the 6th resend inside the window", () => {
        const decision = evaluateVerificationResend(
            {
                emailVerificationLastSentAt: at(3600_000),
                emailVerificationSendWindowStart: at(2 * 3600_000),
                emailVerificationSendCount24h: VERIFICATION_RESEND_DAILY_CAP,
            },
            now,
        );
        expect(decision).toEqual({ allowed: false, reason: "daily_cap", retryAfterSeconds: 22 * 3600 });
    });

    test("count keeps accumulating inside the window", () => {
        const windowStart = at(3600_000);
        expect(
            evaluateVerificationResend(
                {
                    emailVerificationLastSentAt: at(120_000),
                    emailVerificationSendWindowStart: windowStart,
                    emailVerificationSendCount24h: 4,
                },
                now,
            ),
        ).toEqual({ allowed: true, windowStart, sendCount: 5 });
    });

    test("an expired window resets the count", () => {
        expect(
            evaluateVerificationResend(
                {
                    emailVerificationLastSentAt: at(25 * 3600_000),
                    emailVerificationSendWindowStart: at(25 * 3600_000),
                    emailVerificationSendCount24h: VERIFICATION_RESEND_DAILY_CAP,
                },
                now,
            ),
        ).toEqual({ allowed: true, windowStart: now, sendCount: 1 });
    });
});

describe("resendVerificationEmailAction", () => {
    test("requires a session", async () => {
        const user = seedUser();
        sessionDid = undefined;
        expect(await resendVerificationEmailAction()).toEqual({ status: "unauthenticated" });
        expect(postmark.sent).toHaveLength(0);
        expect(user.emailVerificationToken).toBe(sha256(OLD_TOKEN));
    });

    test("an invalid session cookie counts as signed out", async () => {
        seedUser();
        sessionThrows = true;
        expect(await resendVerificationEmailAction()).toEqual({ status: "unauthenticated" });
        expect(postmark.sent).toHaveLength(0);
    });

    test("ignores any email the caller passes and sends to the stored address", async () => {
        seedUser();
        const callWithInput = resendVerificationEmailAction as unknown as (
            input: unknown,
        ) => ReturnType<typeof resendVerificationEmailAction>;
        const result = await callWithInput({ email: "attacker@example.test" });
        expect(result).toEqual({
            status: "sent",
            email: STORED_EMAIL,
            retryAfterSeconds: VERIFICATION_RESEND_COOLDOWN_SECONDS,
        });
        expect(postmark.sent).toHaveLength(1);
        expect(postmark.sent[0].to).toBe(STORED_EMAIL);
        expect(postmark.sent[0].templateAlias).toBe("email-verification");
        expect(
            postmark.sent[0].templateModel.actionUrl.startsWith("https://staging.example.test/verify-email?token="),
        ).toBe(true);
    });

    test("cooldown from the signup send is enforced", async () => {
        const user = seedUser({ emailVerificationLastSentAt: secondsAgo(10) });
        const result = await resendVerificationEmailAction();
        expect(result).toEqual({
            status: "rate_limited",
            email: STORED_EMAIL,
            reason: "cooldown",
            retryAfterSeconds: 50,
        });
        expect(postmark.sent).toHaveLength(0);
        expect(user.emailVerificationToken).toBe(sha256(OLD_TOKEN));
    });

    test("a second resend straight after the first hits the cooldown", async () => {
        seedUser();
        expect((await resendVerificationEmailAction()).status).toBe("sent");
        const second = await resendVerificationEmailAction();
        expect(second.status).toBe("rate_limited");
        expect(second.status === "rate_limited" && second.reason).toBe("cooldown");
        expect(postmark.sent).toHaveLength(1);
    });

    test("daily cap is enforced and the count is persisted", async () => {
        const user = seedUser({
            emailVerificationSendWindowStart: secondsAgo(3600),
            emailVerificationSendCount24h: VERIFICATION_RESEND_DAILY_CAP - 1,
        });
        expect((await resendVerificationEmailAction()).status).toBe("sent");
        expect(user.emailVerificationSendCount24h).toBe(VERIFICATION_RESEND_DAILY_CAP);

        user.emailVerificationLastSentAt = secondsAgo(VERIFICATION_RESEND_COOLDOWN_SECONDS + 5);
        const capped = await resendVerificationEmailAction();
        expect(capped.status).toBe("rate_limited");
        if (capped.status === "rate_limited") {
            expect(capped.reason).toBe("daily_cap");
            expect(capped.retryAfterSeconds).toBeGreaterThan(22 * 3600);
            expect(capped.retryAfterSeconds).toBeLessThanOrEqual(23 * 3600);
        }
        expect(postmark.sent).toHaveLength(1);
    });

    test("first resend opens a window with count 1", async () => {
        const user = seedUser();
        await resendVerificationEmailAction();
        expect(user.emailVerificationSendCount24h).toBe(1);
        expect(user.emailVerificationSendWindowStart).toEqual(user.emailVerificationLastSentAt);
    });

    test("the old link stops working and the new one verifies", async () => {
        seedUser();
        await resendVerificationEmailAction();
        const newToken = tokenFromLastEmail();
        expect(newToken).not.toBe(OLD_TOKEN);

        expect(await verifyEmailAction(OLD_TOKEN)).toEqual({
            success: false,
            message: "Invalid or expired verification token.",
        });
        const verified = await verifyEmailAction(newToken);
        expect(verified.success).toBe(true);
        expect(circles.docs[0].isEmailVerified).toBe(true);
    });

    test("already verified returns a distinct result and sends nothing", async () => {
        seedUser({ isEmailVerified: true, emailVerificationToken: null });
        expect(await resendVerificationEmailAction()).toEqual({ status: "already_verified" });
        expect(postmark.sent).toHaveLength(0);
    });

    test("a Postmark failure is reported as failed", async () => {
        seedUser();
        postmark.failNext = new Error("Found inactive addresses: owner@example.test.");
        const result = await resendVerificationEmailAction();
        expect(result.status).toBe("failed");
        expect(postmark.sent).toHaveLength(0);
    });
});

describe("getVerificationResendStatusAction", () => {
    test("signed out", async () => {
        seedUser();
        sessionDid = undefined;
        expect(await getVerificationResendStatusAction()).toEqual({ status: "unauthenticated" });
    });

    test("ready after the cooldown", async () => {
        seedUser();
        expect(await getVerificationResendStatusAction()).toEqual({ status: "ready", email: STORED_EMAIL });
    });

    test("rate limited right after signup", async () => {
        seedUser({ emailVerificationLastSentAt: secondsAgo(1) });
        const status = await getVerificationResendStatusAction();
        expect(status.status).toBe("rate_limited");
    });

    test("already verified", async () => {
        seedUser({ isEmailVerified: true });
        expect(await getVerificationResendStatusAction()).toEqual({ status: "already_verified" });
    });
});
