import { BedDouble, Car, Compass, Megaphone, Mic2, Sparkles, UtensilsCrossed, Volume2, type LucideIcon } from "lucide-react";
import { accommodationSubTypes, tourTeamOfferingTypes, TourTeamOffering } from "@/models/models";

// "hosting_show" reads as "Show space" here (not "Hosting a show") to avoid confusion with the
// separate Home Shows event feature — this offering is a pitch/contact mechanism only, it never
// links to or creates an event. The underlying enum value is left unchanged; this is a copy-only
// rename shared by every consumer of this label map.
export const tourTeamOfferingTypeLabels: Record<(typeof tourTeamOfferingTypes)[number], string> = {
    spare_room: "Accommodation",
    hosting_show: "Show space",
    local_transport: "Transport",
    city_guide: "City knowledge / tour guide",
    home_cooked_meal: "Meal",
    sound_equipment_help: "Sound & equipment help",
    promotion: "Promotion",
};

// Curated subset for venue circles (identityType "venue" — see isPeerifyVenueIdentity), rendered
// via TourTeamOfferingsEditor's allowedTypes prop in presence-settings-form.tsx. spare_room/
// local_transport/city_guide are personal-hospitality gestures from an individual host and don't
// fit a business profile; hosting_show/sound_equipment_help are a venue's core offer, and
// home_cooked_meal fits venues with an attached restaurant/bar. Reuses the existing labels/icons
// unchanged — "Meal" reads fine for a venue, no venue-specific copy needed. Bands are out of scope
// for now (see getOfferMapPins), so this subset isn't used for them.
export const VENUE_TOUR_TEAM_OFFERING_TYPES = ["hosting_show", "sound_equipment_help", "home_cooked_meal"] as const;

// No existing icon-per-offering-type mapping existed anywhere before this (checked the
// offerings-editing UI, offers-step.tsx and presence-settings-form.tsx — both text-only), so
// these are new choices, not a reuse of something established. Shared between CrewOffersWidget
// and the Crew Dashboard so the two admin-facing surfaces showing the same underlying data don't
// visually diverge — see the Crew Dashboard investigation's visual-consistency finding.
export const tourTeamOfferingTypeIcons: Record<(typeof tourTeamOfferingTypes)[number], LucideIcon> = {
    spare_room: BedDouble,
    hosting_show: Mic2,
    local_transport: Car,
    city_guide: Compass,
    home_cooked_meal: UtensilsCrossed,
    sound_equipment_help: Volume2,
    promotion: Megaphone,
};

// Accepts a plain string (not just TourTeamOffering["type"]) so callers working from a
// string-typed aggregate (e.g. CrewOfferAggregateEntry) don't need an unsafe cast — the lookup
// already falls back to Sparkles for anything unrecognized, so widening this is harmless.
export const getTourTeamOfferingIcon = (offering: { type: string }): LucideIcon =>
    tourTeamOfferingTypeIcons[offering.type as (typeof tourTeamOfferingTypes)[number]] ?? Sparkles;

export const accommodationSubTypeLabels: Record<(typeof accommodationSubTypes)[number], string> = {
    room: "Private room",
    couch: "Couch / shared space",
    other: "Other",
};

export function getTourTeamOfferingLabel(offering: Pick<TourTeamOffering, "type" | "label">): string {
    if (offering.type === "custom") {
        return offering.label?.trim() || "Custom offering";
    }
    return tourTeamOfferingTypeLabels[offering.type] ?? offering.type;
}
