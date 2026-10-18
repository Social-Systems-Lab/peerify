// What /admin/emails shows, decided here so it can be tested without rendering. The page is a 404
// unless capture mode is on (checked first, before any login or database access, so on prod it is
// indistinguishable from a missing page) and the viewer is a platform admin (a 404 too, so it
// doesn't reveal itself).

import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getUserPrivate } from "@/lib/data/user";
import { isEmailCaptureOn } from "./capture-mode";
import { listCapturedEmails } from "./captured-emails";

export type CapturedEmailView = {
    id: string;
    to: string;
    templateAlias: string;
    createdAt: string;
    // http(s) URLs found in the model, the action link first; nothing else becomes a link.
    links: string[];
    // The full model as indented JSON text (shown as text, never as HTML).
    modelJson: string;
};

export type CapturedEmailsPageData = { status: "not_found" } | { status: "ok"; emails: CapturedEmailView[] };

const isHttpUrl = (value: string): boolean => {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
};

export const linksInModel = (model: Record<string, unknown>): string[] => {
    const found: string[] = [];
    const visit = (value: unknown) => {
        if (typeof value === "string") {
            if (isHttpUrl(value) && !found.includes(value)) found.push(value);
        } else if (Array.isArray(value)) {
            value.forEach(visit);
        } else if (value && typeof value === "object") {
            Object.values(value).forEach(visit);
        }
    };
    visit(model.action_url);
    visit(model);
    return found;
};

const isPlatformAdmin = async (): Promise<boolean> => {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return false;
        const user = await getUserPrivate(userDid);
        return user.isAdmin === true;
    } catch {
        // An invalid session or a missing user is simply not an admin.
        return false;
    }
};

export const loadCapturedEmailsPage = async (): Promise<CapturedEmailsPageData> => {
    if (!isEmailCaptureOn()) {
        return { status: "not_found" };
    }
    if (!(await isPlatformAdmin())) {
        return { status: "not_found" };
    }
    const docs = await listCapturedEmails();
    return {
        status: "ok",
        emails: docs.map((doc) => ({
            id: String(doc._id),
            to: doc.to,
            templateAlias: doc.templateAlias,
            createdAt: doc.createdAt.toISOString(),
            links: linksInModel(doc.templateModel),
            modelJson: JSON.stringify(doc.templateModel, null, 2),
        })),
    };
};
