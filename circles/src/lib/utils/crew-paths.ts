// Where a crew_application notification's Review button and its push go: the pending
// applications at the top of the Crew Dashboard. The Dashboard sends circles that aren't managed
// artist identities (e.g. personal profiles with Crew) on to the Crew Applications settings page.
export const getCrewApplicationsReviewPath = (handle: string): string => `/circles/${handle}/settings/crew#applications`;
