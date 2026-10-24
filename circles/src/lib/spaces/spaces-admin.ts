// What /admin/spaces shows, decided here so it can be tested without rendering (the same shape as
// lib/email/captured-emails-admin.ts). A 404 unless the viewer is a platform admin, so the page
// doesn't reveal itself; the /admin dashboard's own redirect is a separate, second check. Owner
// emails are shown on the page only: never logged, never exported.

import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { AdminSpaceRow, getSpaceActor, listAllSpacesForAdmin } from "@/lib/data/space";

export type AdminSpacesPageData = { status: "not_found" } | { status: "ok"; spaces: AdminSpaceRow[] };

const isPlatformAdmin = async (): Promise<boolean> => {
    try {
        const actor = await getSpaceActor(await getAuthenticatedUserDid());
        return actor?.isAdmin === true;
    } catch {
        // An invalid session or a missing user is simply not an admin.
        return false;
    }
};

export const loadAdminSpacesPage = async (): Promise<AdminSpacesPageData> => {
    if (!(await isPlatformAdmin())) {
        return { status: "not_found" };
    }
    return { status: "ok", spaces: await listAllSpacesForAdmin() };
};
