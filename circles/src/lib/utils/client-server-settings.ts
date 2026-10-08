import type { ServerSettings } from "@/models/models";

// The only shape of server settings that may reach a client component (the /admin dashboard's
// GlobalServerSettingsForm and the circle server-settings page's ServerSettingsForm). Built from
// an allow-list, so a secret added to the serverSettings document or merged in from env later
// can't reach the browser by default.
//
// Secrets are reported as "set" / "not set" only. They come from the server environment
// (.env.local), which is what the app actually reads: auth/jwt.ts signs with CIRCLES_JWT_SECRET
// (falling back to JWT_SECRET) and data/vdb.ts uses OPENAI_API_KEY. A copy stored in the
// serverSettings document was never read, so the forms no longer edit these values at all.

export type SecretStatus = "set" | "not set";

export type ClientServerSettings = Pick<
    ServerSettings,
    "name" | "description" | "url" | "registryUrl" | "did" | "defaultCircleId" | "mapboxKey" | "serverVersion"
> & {
    activeRegistryInfo?: { registryUrl?: string; registeredAt?: Date };
    secrets: {
        jwtSecret: SecretStatus;
        openaiKey: SecretStatus;
    };
};

// mapboxKey is a public "pk." token: every page already sends it to the browser for the map.
const CLIENT_SETTINGS_FIELDS = [
    "name",
    "description",
    "url",
    "registryUrl",
    "did",
    "defaultCircleId",
    "mapboxKey",
    "serverVersion",
] as const satisfies readonly (keyof ServerSettings)[];

const statusOf = (value: string | undefined): SecretStatus => (value ? "set" : "not set");

export function toClientServerSettings(
    settings: ServerSettings | null | undefined,
    env: Record<string, string | undefined> = process.env,
): ClientServerSettings {
    const result: ClientServerSettings = {
        secrets: {
            jwtSecret: statusOf(env.CIRCLES_JWT_SECRET || env.JWT_SECRET),
            openaiKey: statusOf(env.OPENAI_API_KEY),
        },
    };
    for (const key of CLIENT_SETTINGS_FIELDS) {
        const value = settings?.[key];
        if (typeof value === "string") {
            result[key] = value;
        }
    }
    const registry = settings?.activeRegistryInfo;
    if (registry) {
        result.activeRegistryInfo = { registryUrl: registry.registryUrl, registeredAt: registry.registeredAt };
    }
    return result;
}
