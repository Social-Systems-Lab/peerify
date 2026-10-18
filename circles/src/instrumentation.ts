// Runs once when the Next.js server starts (not per request).

export async function register(): Promise<void> {
    // Node server only: not the edge runtime, and not `next build` (which may load this file too).
    if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.IS_BUILD === "true") {
        return;
    }
    const { enforceEmailCaptureModeAtBoot } = await import("./lib/email/capture-mode");
    enforceEmailCaptureModeAtBoot();
}
