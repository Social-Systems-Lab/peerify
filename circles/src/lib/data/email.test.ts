import assert from "node:assert/strict";
import { createEmailSender, redactEmailAddresses } from "./email";

// Run: bun src/lib/data/email.test.ts — no network; the Postmark client is a fake.

const RECIPIENT = "someone@example.com";
const OPTIONS = { to: RECIPIENT, templateAlias: "email-verification", templateModel: { name: "Test" } };

const captureLogs = async <T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> => {
    const lines: string[] = [];
    const original = { log: console.log, error: console.error, warn: console.warn };
    const capture = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    console.log = capture;
    console.error = capture;
    console.warn = capture;
    try {
        return { value: await fn(), lines };
    } finally {
        Object.assign(console, original);
    }
};

const okClient = {
    calls: [] as unknown[],
    async sendEmailWithTemplate(message: unknown) {
        this.calls.push(message);
        return { ErrorCode: 0, Message: "OK", MessageID: "msg-123", SubmittedAt: "", To: RECIPIENT };
    },
};

class FakeInactiveRecipientsError extends Error {
    code = 406;
    statusCode = 422;
}

const failingClient = {
    async sendEmailWithTemplate(): Promise<never> {
        throw new FakeInactiveRecipientsError(`Found inactive addresses: ${RECIPIENT}.`);
    },
};

const main = async () => {
    // --- not configured: no client ---
    {
        const { trySendEmail, sendEmail } = createEmailSender(null, "no-reply@example.org");
        const { value, lines } = await captureLogs(() => trySendEmail(OPTIONS));
        assert.equal(value.ok, false);
        assert.equal(!value.ok && value.reason, "not_configured");
        assert.ok(lines.some((l) => l.includes("POSTMARK_API_TOKEN")));
        // sendEmail must not throw for not_configured (unchanged for existing callers), but now reports it
        const viaSend = await captureLogs(() => sendEmail(OPTIONS));
        assert.equal(viaSend.value.ok, false);
    }

    // --- not configured: no sender ---
    {
        const { trySendEmail } = createEmailSender(okClient as never, undefined);
        const { value } = await captureLogs(() => trySendEmail(OPTIONS));
        assert.equal(!value.ok && value.reason, "not_configured");
        assert.equal(okClient.calls.length, 0, "must not call Postmark without a sender");
    }

    // --- success ---
    {
        const { trySendEmail } = createEmailSender(okClient as never, "no-reply@example.org");
        const { value, lines } = await captureLogs(() => trySendEmail(OPTIONS));
        assert.deepEqual(value, { ok: true, messageId: "msg-123" });
        assert.equal(okClient.calls.length, 1);
        assert.ok(!lines.join("\n").includes(RECIPIENT), "success log must not contain the recipient");
    }

    // --- Postmark rejects ---
    {
        const { trySendEmail, sendEmail } = createEmailSender(failingClient as never, "no-reply@example.org");
        const { value, lines } = await captureLogs(() => trySendEmail(OPTIONS));
        assert.equal(value.ok, false);
        assert.equal(!value.ok && value.reason, "send_failed");
        assert.equal(!value.ok && value.code, 406);
        assert.ok(!lines.join("\n").includes(RECIPIENT), "failure log must not contain the recipient");

        // sendEmail keeps throwing on a Postmark error, as existing callers expect
        await captureLogs(() => assert.rejects(() => sendEmail(OPTIONS), /Failed to send email/));
    }

    assert.equal(redactEmailAddresses("to a.b+c@x.co and d@e.org"), "to <redacted> and <redacted>");

    console.log("email tests passed");
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
