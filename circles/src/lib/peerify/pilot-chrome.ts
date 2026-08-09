// Visual-identity pilot: new "chrome" palette (ink/cream/paper/line/muted/orange) and
// Cormorant Garamond / Manrope fonts, scoped to a single real page for side-by-side
// comparison against the current look before any wider rollout decision. Deliberately
// hardcoded to one handle/path rather than a themeable setting — this is a throwaway
// pilot, not the (separate, later) per-artist customizable theming feature.
export const PILOT_CHROME_HANDLE = "tim-admin";
export const PILOT_CHROME_PATH = "/circles/tim-admin/home";

export function isPilotChromePath(pathname: string | null | undefined): boolean {
    return pathname === PILOT_CHROME_PATH;
}
