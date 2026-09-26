// Whether the Verified Contributions panel is shown on personal profiles. Lives in its own plain
// (non-"use client") module so both AboutPage (which renders the panel) and the server-side
// home/page.tsx (which loads its data) read the same switch — while it's off, the page skips
// getVerifiedTasksForUser entirely, so contribution data is neither loaded nor sent to the client.
// Hidden per request: set to true to re-enable.
export const VERIFIED_CONTRIBUTIONS_PANEL_ENABLED = false;
