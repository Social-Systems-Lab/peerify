// Staging only (EMAIL_CAPTURE_MODE=on): emails stored instead of sent, read by /admin/emails.
// email.ts loads this module only in capture mode, so with capture off nothing here runs and the
// capturedEmails collection is never created.

import { CapturedEmails, type CapturedEmailDoc } from "@/lib/data/db";

// The links inside are live (a login link is a session), so they don't outlive their own expiry
// by much: 24 hours, then the TTL index removes them.
export const CAPTURED_EMAIL_TTL_MS = 24 * 3600 * 1000;
export const CAPTURED_EMAIL_LIST_LIMIT = 50;

// Created on the first capture in this process rather than at module load (as rateLimits does),
// because creating an index creates the collection.
let indexReady: Promise<unknown> | null = null;
const ensureTtlIndex = (): Promise<unknown> => {
    if (!indexReady) {
        indexReady = CapturedEmails.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((error) => {
            indexReady = null;
            throw error;
        });
    }
    return indexReady;
};

export type CapturedEmailInput = Pick<CapturedEmailDoc, "to" | "templateAlias" | "templateModel">;

// Returns the stored document's id.
export const storeCapturedEmail = async (email: CapturedEmailInput, now: Date = new Date()): Promise<string> => {
    await ensureTtlIndex();
    const result = await CapturedEmails.insertOne({
        to: email.to,
        templateAlias: email.templateAlias,
        templateModel: email.templateModel,
        createdAt: now,
        expiresAt: new Date(now.getTime() + CAPTURED_EMAIL_TTL_MS),
    });
    return String(result.insertedId);
};

// Newest first, younger than the TTL (the TTL monitor only runs about once a minute).
export const listCapturedEmails = async (now: Date = new Date()) =>
    CapturedEmails.find({ createdAt: { $gt: new Date(now.getTime() - CAPTURED_EMAIL_TTL_MS) } })
        .sort({ createdAt: -1 })
        .limit(CAPTURED_EMAIL_LIST_LIMIT)
        .toArray();
