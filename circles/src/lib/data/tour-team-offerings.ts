import { BedDouble, Car, Compass, Megaphone, Mic2, Sparkles, UtensilsCrossed, Volume2, type LucideIcon } from "lucide-react";
import { accommodationSubTypes, promotionChannels, tourTeamOfferingTypes, TourTeamOffering } from "@/models/models";

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

// The five structured types offered in the "Create an offer" modal's Step 1 grid, in display
// order (Accommodation, Show space, Meal, Transport, Promotion) — each has a matching
// offerDetailsSchema variant and a Step 2 form. "Other" (type "custom") is always offered
// alongside these, generic/type-less, and isn't part of this list. city_guide/sound_equipment_help
// predate this modal and have no Step 2 form of their own — they're no longer creatable from the
// modal (existing offerings of those types still render/persist fine).
export const OFFER_MODAL_TYPES = ["spare_room", "hosting_show", "home_cooked_meal", "local_transport", "promotion"] as const;

// Curated subset of OFFER_MODAL_TYPES for venue circles (identityType "venue" — see
// isPeerifyVenueIdentity), passed as CreateOfferModal's allowedTypes for venue presence settings.
// spare_room/local_transport are personal-hospitality gestures from an individual host and don't
// fit a business profile. hosting_show/home_cooked_meal are a venue's core offer (a bar/venue with
// an attached restaurant). promotion is included — a venue promoting a show locally (flyers,
// regulars, local listings) is a natural business offer, no reason to restrict it to personal
// circles. Bands are out of scope for now (see getOfferMapPins), so this subset isn't used for them.
export const VENUE_OFFER_MODAL_TYPES = ["hosting_show", "home_cooked_meal", "promotion"] as const;

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

export const promotionChannelLabels: Record<(typeof promotionChannels)[number], string> = {
    social_media: "Social media",
    radio: "Local radio",
    press: "Press / local listings",
    flyering: "Flyering",
    newsletter: "Newsletter",
    other: "Other",
};

// One-line summary of an offering's structured `details`, for the Presence-settings offer list
// and (now) CrewOfferMapPreview's member-facing full offer panel — undefined for legacy/
// bare-bones offerings (no `details` yet) or types with no Step 2 form, so callers can render
// nothing extra rather than an empty line. Takes just `{ details }` rather than the full
// TourTeamOffering so the member-facing OfferMemberDetails shape (models.ts) — which carries the
// same `details` field but not the rest of TourTeamOffering — can reuse this directly.
export function getOfferDetailsSummary(offering: Pick<TourTeamOffering, "details">): string | undefined {
    const details = offering.details;
    if (!details) return undefined;

    switch (details.type) {
        case "accommodation": {
            const parts: string[] = [];
            if (details.maxStayNights) parts.push(`Up to ${details.maxStayNights} night${details.maxStayNights === 1 ? "" : "s"}`);
            if (details.checkInFlexible) parts.push("Flexible check-in");
            return parts.join(" · ") || undefined;
        }
        case "hostingShow": {
            const parts: string[] = [];
            if (details.capacity) parts.push(`Capacity ~${details.capacity}`);
            if (details.spaceDescription) parts.push(details.spaceDescription);
            return parts.join(" · ") || undefined;
        }
        case "meal": {
            const parts: string[] = [];
            if (details.cuisine) parts.push(details.cuisine);
            if (details.dietaryNotes) parts.push(details.dietaryNotes);
            return parts.join(" · ") || undefined;
        }
        case "transport":
            return details.routeNotes || undefined;
        case "promotion": {
            const parts: string[] = [];
            if (details.channels?.length) parts.push(details.channels.map((c) => promotionChannelLabels[c]).join(", "));
            if (details.notes) parts.push(details.notes);
            return parts.join(" · ") || undefined;
        }
        default:
            return undefined;
    }
}
