// Client-side helper for the <altcha-widget> element. Challenges are single-use on the server, so
// after a failed submit the solved payload is spent: clear it and start solving a fresh challenge
// right away, while the person fixes whatever the error was.
type AltchaWidgetElement = HTMLElement & { reset?: () => void; verify?: () => Promise<unknown> };

export function restartAltcha(el: HTMLElement | null, setPayload: (payload: string | null) => void): void {
    setPayload(null);
    const widget = el as AltchaWidgetElement | null;
    widget?.reset?.();
    widget?.verify?.()?.catch(() => {
        // The widget shows its own error state; the person can click it to retry.
    });
}
