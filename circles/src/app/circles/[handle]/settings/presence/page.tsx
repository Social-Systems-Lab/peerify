import { redirect } from "next/navigation";
import { PresenceSettingsForm } from "@/components/forms/circle-settings/presence-settings-form";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { getCircleByHandle } from "@/lib/data/circle";
import { features } from "@/lib/data/constants";

type PageProps = {
    params: Promise<{ handle: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function PresenceSettingsPage(props: PageProps) {
    const params = await props.params;
    const { handle } = params;
    const circle = await getCircleByHandle(handle);

    if (!circle?._id) {
        return <div>Circle not found</div>;
    }

    // This page fetches the circle via getCircleByHandle — the same generic, non-owner-scoped
    // lookup used everywhere in the app, not something that only ever returns "my own circle".
    // Its safety previously rode entirely on middleware.ts + accessRules.settings.view staying
    // ["admins"] for this circle, with no independent check here — if an admin ever broadened
    // that access rule (or it was ever misconfigured), this page would hand tourTeamOfferings
    // and other presence fields to whoever could load the URL. Explicit re-check, defense-in-depth.
    const userDid = await getAuthenticatedUserDid();
    const canManage = await isAuthorized(userDid, circle._id, features.settings.edit_about);
    if (!canManage) {
        redirect(`/circles/${handle}/access-denied?module=settings&redirectTo=/circles/${handle}/settings/presence`);
    }

    const isUser = circle.circleType === "user";

    return (
        <div className="container py-6">
            <h1 className="mb-6 text-2xl font-bold">{isUser ? "Offers" : "Offers and needs"}</h1>
            <p className="mb-6 text-muted-foreground">
                {isUser
                    ? "Ways I can contribute to visiting artists."
                    : "Describe your opportunities and what support your circle or project needs."}
            </p>
            <PresenceSettingsForm circle={circle} />
        </div>
    );
}
