import { ServerSettingsForm } from "@/components/forms/circle-settings/server-settings-form";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getServerSettings } from "@/lib/data/server-settings";
import { getUserPrivate } from "@/lib/data/user";
import { toClientServerSettings } from "@/lib/utils/client-server-settings";
import { redirect } from "next/navigation";

type PageProps = {
    params: Promise<{ handle: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function ServerSettingsPage(props: PageProps) {
    // Server settings are platform-wide, so the VIEWER must be a platform admin, the same check
    // /admin and saveServerSettings make. Which circle's URL this is reached through doesn't
    // matter. The middleware's settings-module check for the circle still runs first.
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        redirect("/unauthenticated");
    }
    const viewer = await getUserPrivate(userDid).catch(() => null);
    if (viewer?.isAdmin !== true) {
        return <div>You do not have permission to access server settings</div>;
    }

    const serverSettings = toClientServerSettings(await getServerSettings());

    return (
        <div className="container py-6">
            <h1 className="mb-6 text-2xl font-bold">Server Settings</h1>
            <p className="mb-6 text-muted-foreground">
                Configure server-wide settings including API keys and server information. These settings affect the
                entire application.
            </p>
            <ServerSettingsForm serverSettings={serverSettings} />
        </div>
    );
}
