// Email capture mode, for staging: with EMAIL_CAPTURE_MODE=on every outgoing email is stored for the
// admin page /admin/emails instead of being sent. Nothing turns it on except that setting (a missing
// or failing Postmark never does), and it is only allowed when every base URL the app builds links
// from names a staging or local host. Free of database imports so it can be unit-tested directly.

// Exact hostnames only: a new name (a future prod name included) stays refused until it is added here
// on purpose.
export const EMAIL_CAPTURE_ALLOWED_HOSTS = ["staging.peerify.one", "cleura-staging.peerify.one", "localhost", "127.0.0.1"];

// The settings links in emails are built from (see resolveResetBaseUrl and buildEmailVerificationLink).
// CIRCLES_URL is required for capture; the others are checked when set.
const BASE_URL_SETTINGS = ["CIRCLES_URL", "NEXT_PUBLIC_APP_URL", "APP_URL", "SITE_URL", "NEXT_PUBLIC_SITE_URL"] as const;

type Env = Record<string, string | undefined>;

export type EmailCaptureCheck = { mode: "off" } | { mode: "on" } | { mode: "refused"; reason: string };

const hostnameOf = (value: string): string | null => {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:" ? url.hostname.toLowerCase() : null;
    } catch {
        return null;
    }
};

export const checkEmailCaptureMode = (env: Env = process.env): EmailCaptureCheck => {
    const raw = env.EMAIL_CAPTURE_MODE;
    if (raw === undefined || raw === "" || raw === "off") {
        return { mode: "off" };
    }
    // Anything but exactly "on" is a typo: it must neither leave real sending on by accident nor
    // turn capture on by accident.
    if (raw !== "on") {
        // The value itself isn't echoed, in case something else was pasted there by mistake.
        return { mode: "refused", reason: `EMAIL_CAPTURE_MODE must be "on", "off" or empty (got ${raw.length} other characters)` };
    }
    if (!env.CIRCLES_URL) {
        return { mode: "refused", reason: "EMAIL_CAPTURE_MODE=on needs CIRCLES_URL set to a staging URL" };
    }
    for (const name of BASE_URL_SETTINGS) {
        const value = env[name];
        if (!value) continue;
        const hostname = hostnameOf(value);
        if (!hostname || !EMAIL_CAPTURE_ALLOWED_HOSTS.includes(hostname)) {
            return {
                mode: "refused",
                reason: `EMAIL_CAPTURE_MODE=on is only allowed on staging, but ${name} points to ${hostname ?? "an invalid URL"}`,
            };
        }
    }
    return { mode: "on" };
};

export const isEmailCaptureOn = (env: Env = process.env): boolean => checkEmailCaptureMode(env).mode === "on";

// Called once at server start (src/instrumentation.ts). A refused setting stops the process: better a
// staging box that doesn't start than one that might mail real people.
export const enforceEmailCaptureModeAtBoot = (
    env: Env = process.env,
    exit: (code: number) => void = (code) => process.exit(code),
): EmailCaptureCheck => {
    const check = checkEmailCaptureMode(env);
    if (check.mode === "refused") {
        console.error(`[email-capture] Refusing to start: ${check.reason}. Fix or remove EMAIL_CAPTURE_MODE.`);
        exit(1);
    } else if (check.mode === "on") {
        console.log("[email-capture] Email capture mode ON: no email will be sent; captured emails at /admin/emails");
    }
    return check;
};
