// Shared between the client dialog (select options) and the server action (email
// merge fields) — kept out of actions.ts because a "use server" file may only
// export async functions, not plain constants.

export const CONTACT_REASON_VALUES = ["join", "funding", "account_access", "general"] as const;

export type ContactReason = (typeof CONTACT_REASON_VALUES)[number]

export const CONTACT_REASONS: { value: ContactReason; label: string }[] = [
    { value: "join", label: "I'd like to help out" },
    { value: "funding", label: "Funding or partnership" },
    { value: "account_access", label: "Trouble signing up or logging in" },
    { value: "general", label: "General question" },
]
