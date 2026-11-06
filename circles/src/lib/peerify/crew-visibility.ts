// When Crew features show. Crew is on only when the circle's navigation would show its tab:
// "crew" in Settings > Modules (enabledModules) and the About page's Crew toggle (crewEnabled) not
// off. That is isModuleEnabled(circle, "crew"), the same check circle-tabs and the /api/access
// route guard use, so no button can point at a Crew page that would answer "not found".
// Used by Join Crew / View Crew (profile, Discover card, pledge dialog), the Crew Dashboard
// button and its badge, the Crew Dashboard and Crew Applications pages, and the server-side
// check in applyForCrewMembership.
import { isModuleEnabled } from "@/lib/auth/client-auth";
import { Circle } from "@/models/models";
import { isPeerifyManagedIdentity } from "./artist-profile";

export const isCrewOn = (circle: Circle): boolean => isModuleEnabled(circle, "crew");

// The Crew Dashboard button on the profile (and its pending-count badge): managers of a managed
// artist identity whose Crew is on.
export const showsCrewDashboardButton = (circle: Circle, authorizedToEdit: boolean): boolean =>
    authorizedToEdit && isPeerifyManagedIdentity(circle) && isCrewOn(circle) && Boolean(circle.handle);

export const CREW_OFF_APPLICATION_MESSAGE =
    "Crew is switched off for this profile, so it isn't taking applications right now.";
