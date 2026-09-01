import { BedDouble, Car, Compass, Mic2, Sparkles, UtensilsCrossed, Volume2, type LucideIcon } from "lucide-react";
import { accommodationSubTypes, tourTeamOfferingTypes, TourTeamOffering } from "@/models/models";

export const tourTeamOfferingTypeLabels: Record<(typeof tourTeamOfferingTypes)[number], string> = {
    spare_room: "Accommodation",
    hosting_show: "Hosting a show",
    local_transport: "Transport",
    city_guide: "City knowledge / tour guide",
    home_cooked_meal: "Meal",
    sound_equipment_help: "Sound & equipment help",
};

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
