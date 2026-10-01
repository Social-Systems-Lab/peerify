// Replaces the "postmark" package for bun tests, so the real src/lib/data/email.ts runs against a
// fake client and nothing leaves the machine. Call before the first import of email.ts.

import { mock } from "bun:test";

export type SentTemplateEmail = { from: string; templateAlias: string; templateModel: Record<string, any>; to: string };

export const installPostmarkMock = () => {
    const state = { sent: [] as SentTemplateEmail[], failNext: null as Error | null };

    process.env.POSTMARK_API_TOKEN = "test-token-not-real";
    process.env.POSTMARK_SENDER_EMAIL = "no-reply@example.test";

    class TemplatedMessage {
        constructor(
            public From: string,
            public TemplateAlias: string,
            public TemplateModel: Record<string, any>,
            public To: string,
        ) {}
    }

    class ServerClient {
        async sendEmailWithTemplate(message: TemplatedMessage) {
            if (state.failNext) {
                const error = state.failNext;
                state.failNext = null;
                throw error;
            }
            state.sent.push({
                from: message.From,
                templateAlias: message.TemplateAlias,
                templateModel: message.TemplateModel,
                to: message.To,
            });
            return {
                ErrorCode: 0,
                Message: "OK",
                MessageID: `msg-${state.sent.length}`,
                SubmittedAt: "",
                To: message.To,
            };
        }
    }

    mock.module("postmark", () => ({ ServerClient, TemplatedMessage }));
    return state;
};
