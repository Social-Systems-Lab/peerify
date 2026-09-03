"use server";

import { z } from "zod";
import { sendEmail } from "@/lib/data/email";
import { emailSchema } from "@/models/models";
import { CONTACT_REASON_VALUES, CONTACT_REASONS } from "./constants";

const REASON_LABELS: Record<string, string> = Object.fromEntries(CONTACT_REASONS.map((r) => [r.value, r.label]));

const contactFormSchema = z.object({
    name: z.string().trim().min(1, "Please enter your name"),
    email: emailSchema,
    reason: z.enum(CONTACT_REASON_VALUES, { errorMap: () => ({ message: "Please choose a reason" }) }),
    message: z.string().trim().min(1, "Please enter a message"),
    // Honeypot: real users never see or fill this field (it's hidden off-screen client-side).
    // If it comes back non-empty, treat the submission as a bot and silently "succeed" without
    // sending anything, so the bot gets no signal that it was caught.
    company: z.string().optional(),
});

export type ContactFormInput = z.infer<typeof contactFormSchema>;

interface ContactFormResponse {
    success: boolean;
    message: string;
}

const SUCCESS_MESSAGE = "Thanks — we'll get back to you soon.";
const GENERIC_ERROR_MESSAGE = "Something went wrong sending your message. Please try again in a moment.";

export async function submitContactFormAction(input: ContactFormInput): Promise<ContactFormResponse> {
    const validation = contactFormSchema.safeParse(input);
    if (!validation.success) {
        return { success: false, message: "Please check the form and try again." };
    }

    const { name, email, reason, message, company } = validation.data;

    if (company && company.trim().length > 0) {
        return { success: true, message: SUCCESS_MESSAGE };
    }

    try {
        await sendEmail({
            to: "hello@socialsystems.io",
            templateAlias: "contact-form",
            templateModel: {
                submitter_name: name,
                submitter_email: email,
                reason: REASON_LABELS[reason] || reason,
                message,
            },
        });
        return { success: true, message: SUCCESS_MESSAGE };
    } catch (error) {
        console.error("Failed to send contact form email:", error);
        return { success: false, message: GENERIC_ERROR_MESSAGE };
    }
}
