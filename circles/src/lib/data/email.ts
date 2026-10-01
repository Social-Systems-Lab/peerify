import { ServerClient, TemplatedMessage } from "postmark";
import crypto from "crypto";

const POSTMARK_API_TOKEN = process.env.POSTMARK_API_TOKEN;
const POSTMARK_SENDER_EMAIL = process.env.POSTMARK_SENDER_EMAIL;
const SOCIAL_SYSTEMS_LAB_URL = "https://www.socialsystems.io/";

if (!POSTMARK_API_TOKEN) {
    console.warn("POSTMARK_API_TOKEN is not set. Email functionality will be disabled.");
}
if (!POSTMARK_SENDER_EMAIL) {
    console.warn("POSTMARK_SENDER_EMAIL is not set. Email functionality will be disabled.");
}

// Initialize Postmark client
// It's okay if token is undefined here; checks below will prevent API calls.
const client = POSTMARK_API_TOKEN ? new ServerClient(POSTMARK_API_TOKEN) : null;

interface EmailOptions {
    to: string;
    templateAlias: string;
    templateModel: Record<string, any>;
}

const getTemplateString = (templateModel: Record<string, any>, ...keys: string[]): string | undefined => {
    for (const key of keys) {
        const value = templateModel[key];
        if (typeof value === "string" && value.trim().length > 0) {
            return value;
        }
    }

    return undefined;
};

export const applyEmailTemplateDefaults = (templateModel: Record<string, any>): Record<string, any> => {
    const productUrl =
        getTemplateString(templateModel, "productUrl", "product_url") || process.env.CIRCLES_URL || "http://localhost:3000";
    const actionUrl = getTemplateString(templateModel, "actionUrl", "action_url");
    const actionText = getTemplateString(templateModel, "actionText", "action_text", "buttonText", "button_text");
    const introText = getTemplateString(templateModel, "introText", "intro_text");
    const bodyText = getTemplateString(templateModel, "bodyText", "body_text");
    const summaryText = getTemplateString(templateModel, "summaryText", "summary_text");
    const defaults = { ...templateModel };

    defaults.product_url = productUrl;
    defaults.product_name = "Peerify";
    defaults.company_name = "Social Systems Lab";
    defaults.company_url = SOCIAL_SYSTEMS_LAB_URL;
    defaults.company_address = "";
    defaults.email_signoff_html =
        `Thanks for being part of Peerify!<br><br>The Peerify Team at <a href="${SOCIAL_SYSTEMS_LAB_URL}">Social Systems Lab</a>`;
    defaults.email_signoff_text =
        `Thanks for being part of Peerify!\n\nThe Peerify Team at Social Systems Lab\n${SOCIAL_SYSTEMS_LAB_URL}`;
    defaults.name = templateModel.name || "User";
    defaults.action_url = actionUrl;
    if (actionText) {
        defaults.action_text = actionText;
        defaults.button_text = actionText;
    }
    if (introText) {
        defaults.intro_text = introText;
    }
    if (bodyText) {
        defaults.body_text = bodyText;
    }
    if (summaryText) {
        defaults.summary_text = summaryText;
    }
    defaults.support_email = "hello@socialsystems.io";
    defaults.current_year = new Date().getFullYear().toString();

    return defaults;
};

// What a send actually did. Postmark API errors still throw from sendEmail (existing callers
// rely on that); trySendEmail folds them into { ok: false, reason: "send_failed" } instead.
export type SendEmailResult =
    | { ok: true; messageId: string }
    | { ok: false; reason: "not_configured" | "send_failed"; message: string; code?: number };

type TemplateEmailClient = Pick<ServerClient, "sendEmailWithTemplate">;

const EMAIL_ADDRESS_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Postmark error messages can name the recipient (e.g. InactiveRecipientsError), so strip
// addresses before anything reaches a log line.
export const redactEmailAddresses = (text: string): string => text.replace(EMAIL_ADDRESS_PATTERN, "<redacted>");

// Exported for tests, which pass a fake client; the app uses sendEmail/trySendEmail below.
export const createEmailSender = (emailClient: TemplateEmailClient | null, senderEmail: string | undefined) => {
    const trySendEmail = async (options: EmailOptions): Promise<SendEmailResult> => {
        const { to, templateAlias, templateModel } = options;
        if (!emailClient) {
            console.error(`Email not sent (template ${templateAlias}): POSTMARK_API_TOKEN is not configured.`);
            return { ok: false, reason: "not_configured", message: "POSTMARK_API_TOKEN is not configured." };
        }
        if (!senderEmail) {
            console.error(`Email not sent (template ${templateAlias}): POSTMARK_SENDER_EMAIL is not configured.`);
            return { ok: false, reason: "not_configured", message: "POSTMARK_SENDER_EMAIL is not configured." };
        }

        const message = new TemplatedMessage(senderEmail, templateAlias, applyEmailTemplateDefaults(templateModel), to);

        try {
            const response = await emailClient.sendEmailWithTemplate(message);
            console.log(`Email sent using template ${templateAlias}: MessageID ${response.MessageID}`);
            return { ok: true, messageId: response.MessageID };
        } catch (error) {
            const rawMessage = error instanceof Error ? error.message : String(error);
            const code =
                error && typeof error === "object" && typeof (error as { code?: unknown }).code === "number"
                    ? (error as { code: number }).code
                    : undefined;
            console.error(
                `Failed to send email using template ${templateAlias} (Postmark code ${code ?? "n/a"}): ${redactEmailAddresses(rawMessage)}`,
            );
            return { ok: false, reason: "send_failed", message: rawMessage, code };
        }
    };

    /**
     * Sends an email using Postmark.
     * @returns the send result; { ok: false, reason: "not_configured" } when Postmark isn't set up.
     * @throws Error if Postmark rejects the send.
     */
    const sendEmail = async (options: EmailOptions): Promise<SendEmailResult> => {
        const result = await trySendEmail(options);
        if (!result.ok && result.reason === "send_failed") {
            throw new Error(`Failed to send email: ${result.message}`);
        }
        return result;
    };

    return { sendEmail, trySendEmail };
};

const defaultSender = createEmailSender(client, POSTMARK_SENDER_EMAIL);

export const sendEmail = defaultSender.sendEmail;

// Never throws: Postmark errors come back as { ok: false, reason: "send_failed" }.
export const trySendEmail = defaultSender.trySendEmail;

// Specific email sending functions will be added below in subsequent steps.

/**
 * Generates a secure token for email verification or password reset.
 * @returns string - The generated token.
 */
export const generateSecureToken = (length: number = 32): string => {
    return crypto.randomBytes(length).toString("hex");
};

/**
 * Hashes a token using SHA256.
 * @param token - The token to hash.
 * @returns string - The hashed token.
 */
export const hashToken = (token: string): string => {
    return crypto.createHash("sha256").update(token).digest("hex");
};
