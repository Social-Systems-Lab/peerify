// Visual-identity pilot. Started as a single-page comparison (Tim Admin's own profile,
// circleType "user") against production, then two correction passes against side-by-side
// production review. Now extended: three specific shell fixes — the nav divider, the
// star/megaphone/settings action-icon gating+tinting, and heading font-weight — are no
// longer scoped to that one page, since they're shared components used identically
// everywhere. This is NOT the full visual-identity rollout (colors/fonts elsewhere are
// still untouched outside this shell) — see SESSION_LOG.md for the pilot's full history.
//
// PILOT_CHROME_PATH/isPilotChromePath is the original single-page scope. It's still used
// for the couple of things deliberately NOT extended this round (badges, the --primary/
// --ring tab-accent color, and the profile-menu's own small ink recolors) — those stay
// exactly as narrow as before.
export const PILOT_CHROME_PATH = "/circles/tim-admin/home";

export function isPilotChromePath(pathname: string | null | undefined): boolean {
    return pathname === PILOT_CHROME_PATH;
}

// Broader scope for the heading-weight change specifically: any circle's /home tab, not
// just tim-admin's — but still only the /home tab, not every tab of a circle (settings,
// tasks, feed, etc. render entirely different content there and were never part of what
// was visually tested).
const CIRCLE_HOME_PATH_PATTERN = /^\/circles\/[^/]+\/home\/?$/;

export function isCircleHomePath(pathname: string | null | undefined): boolean {
    return Boolean(pathname && CIRCLE_HOME_PATH_PATTERN.test(pathname));
}
