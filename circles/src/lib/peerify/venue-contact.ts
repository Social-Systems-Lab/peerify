// Contacting a circle's admins (Tim's decision, 2026-11-15, option 1). The venue page's Chat
// button and its About-page contact form (contactCircleAdminsAction) start a private group with the
// person and every admin of the circle, and every member of that group gets each admin's name,
// handle, picture and DID. A venue may be run from a personal account that must stay hidden, so a
// venue can't be contacted this way at all: no button, no form, and the server refuses. Showing the
// admins as the venue instead is planned for "Secret Soirées".

import type { Circle } from "@/models/models";
import { isPeerifyVenueIdentity } from "@/lib/peerify/artist-profile";

export const VENUE_CONTACT_OFF_MESSAGE = "Venues can't be messaged on Peerify yet. Use the contact details on the venue's page.";

// Whether a private group with this circle's admins may be started.
export const canStartCircleAdminContact = (circle?: Partial<Circle> | null): boolean => !isPeerifyVenueIdentity(circle);

// The About page's "Offer Help" / "Ask a question first" form.
export const canShowAboutContactForm = (
    circle: Partial<Circle> | null | undefined,
    { hasMatchingOfferNeeds, isOwner }: { hasMatchingOfferNeeds: boolean; isOwner: boolean },
): boolean => hasMatchingOfferNeeds && !isOwner && canStartCircleAdminContact(circle);
