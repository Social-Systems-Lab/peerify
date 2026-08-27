// Icon/label metadata for the fixed-enum venue/event feature tags (src/lib/peerify/event-
// tags.ts). Single source of truth shared by the editable picker (event-tags-settings.tsx) and
// the read-only display badges (event-tag-badges.tsx) — same icon choices everywhere a tag
// shows up, per the profile-menu.tsx tint treatment established in Phase 2.

import type { LucideIcon } from "lucide-react";
import {
    Accessibility,
    Armchair,
    Backpack,
    Building2,
    CircleHelp,
    DoorClosed,
    Footprints,
    Home,
    IdCard,
    Mic2,
    PersonStanding,
    ShoppingBag,
    Sofa,
    Store,
    TreePine,
    UtensilsCrossed,
    Users,
    Wine,
    WineOff,
} from "lucide-react";
import type {
    EventTagAccessibility,
    EventTagAge,
    EventTagAlcohol,
    EventTagFood,
    EventTagSeating,
    EventTagSetting,
    EventTagVenueType,
} from "@/lib/peerify/event-tags";

export type EventTagIconMeta = { label: string; icon: LucideIcon };

// Record<CategoryValueUnion, ...> — adding/removing a value in EVENT_TAG_*_OPTIONS without
// updating its icon/label here is a compile error, not a silently missing icon.
export const AGE_ICON_META: Record<EventTagAge, EventTagIconMeta> = {
    all_ages: { label: "All ages", icon: Users },
    "18_plus": { label: "18+", icon: IdCard },
};

export const ALCOHOL_ICON_META: Record<EventTagAlcohol, EventTagIconMeta> = {
    byo: { label: "BYO", icon: Backpack },
    served: { label: "Served", icon: Wine },
    not_permitted: { label: "Not permitted", icon: WineOff },
};

export const VENUE_TYPE_ICON_META: Record<EventTagVenueType, EventTagIconMeta> = {
    home: { label: "Home", icon: Home },
    studio: { label: "Studio", icon: Mic2 },
    local_business: { label: "Local business", icon: Store },
    public_venue: { label: "Public venue", icon: Building2 },
};

export const FOOD_ICON_META: Record<EventTagFood, EventTagIconMeta> = {
    available: { label: "Food available", icon: UtensilsCrossed },
    byo_snacks: { label: "BYO snacks", icon: ShoppingBag },
};

export const SEATING_ICON_META: Record<EventTagSeating, EventTagIconMeta> = {
    floor_cushions: { label: "Floor cushions", icon: Sofa },
    seated: { label: "Seated", icon: Armchair },
    standing: { label: "Standing", icon: PersonStanding },
};

export const SETTING_ICON_META: Record<EventTagSetting, EventTagIconMeta> = {
    indoor: { label: "Indoor", icon: DoorClosed },
    outdoor: { label: "Outdoor", icon: TreePine },
};

export const ACCESSIBILITY_ICON_META: Record<EventTagAccessibility, EventTagIconMeta> = {
    accessible: { label: "Accessible", icon: Accessibility },
    stairs_involved: { label: "Stairs involved", icon: Footprints },
    not_specified: { label: "Not specified", icon: CircleHelp },
};

export const toEventTagIconOptions = <T extends string>(
    values: readonly T[],
    meta: Record<T, EventTagIconMeta>,
): Array<{ value: T; label: string; icon: LucideIcon }> => values.map((value) => ({ value, ...meta[value] }));
