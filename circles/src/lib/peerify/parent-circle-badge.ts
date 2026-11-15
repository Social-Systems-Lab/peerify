// Whether a circle's page shows the "Child of <parent>" badge (HomeContent), and so whether its
// parent may be sent to visitors at all (Tim, 2026-11-15). A Peerify managed identity (venue, band,
// artist) never shows it: a venue run from a personal account must not name that account, and the
// page data used to carry it (the layout's parentCircle, and parentCircleId in the public circle)
// even though nothing showed it. The root circle doesn't show it either.

import type { Circle } from "@/models/models";
import { isPeerifyManagedIdentity } from "@/lib/peerify/artist-profile";

const ROOT_CIRCLE_HANDLES = new Set(["default", "kamooni"]);

export const showsParentCircleBadge = (circle?: Partial<Circle> | null): boolean =>
    !!circle?.parentCircleId && !ROOT_CIRCLE_HANDLES.has(String(circle.handle)) && !isPeerifyManagedIdentity(circle);
