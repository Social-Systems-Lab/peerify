import { getCircleByHandle } from "@/lib/data/circle";
import { getPublicCircleForViewer } from "@/lib/data/public-circle-for-viewer";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { features } from "@/lib/data/constants";
import { notFound, redirect } from "next/navigation";
import { SettingsLayoutWrapper } from "./settings-layout-wrapper";

type LayoutProps = {
    params: Promise<{ handle: string }>;
    children: React.ReactNode;
};

export default async function SettingsLayout({ params, children }: LayoutProps) {
    const p = await params;
    const circle = await getCircleByHandle(p.handle);

    if (!circle) {
        notFound();
    }

    // Leak round 3, M7 (2026-11-07): the circle's "View settings" rule, checked here too. The route
    // guard (/api/access) falls back to "everyone" when a circle has no settings rule; this check
    // falls back to the feature default (admins), like every other server-side check.
    const viewerDid = await getAuthenticatedUserDid();
    if (!(await isAuthorized(viewerDid, String(circle._id), features.settings.view))) {
        redirect(`/circles/${p.handle}/access-denied?module=settings&redirectTo=/circles/${p.handle}/settings`);
    }

    // Only what's serialised to client components is shaped: managers (edit_about) get the circle
    // unchanged, anyone else allowed into settings (e.g. moderators) gets the public copy.
    const publicCircle = await getPublicCircleForViewer(circle, viewerDid);
    return <SettingsLayoutWrapper circle={publicCircle}>{children}</SettingsLayoutWrapper>;
}
