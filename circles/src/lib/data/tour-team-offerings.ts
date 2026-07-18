import { accommodationSubTypes, tourTeamOfferingTypes, TourTeamOffering } from "@/models/models";

export const tourTeamOfferingTypeLabels: Record<(typeof tourTeamOfferingTypes)[number], string> = {
    spare_room: "Accommodation",
    hosting_show: "Hosting a show",
    local_transport: "Transport",
    city_guide: "City knowledge / tour guide",
    home_cooked_meal: "Meal",
    sound_equipment_help: "Sound & equipment help",
};

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
