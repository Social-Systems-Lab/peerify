"use client";

import React from "react";
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
import { Label } from "@/components/ui/label";
import {
    EVENT_TAG_ACCESSIBILITY_OPTIONS,
    EVENT_TAG_AGE_OPTIONS,
    EVENT_TAG_ALCOHOL_OPTIONS,
    EVENT_TAG_FOOD_OPTIONS,
    EVENT_TAG_SEATING_OPTIONS,
    EVENT_TAG_SETTING_OPTIONS,
    EVENT_TAG_VENUE_TYPE_OPTIONS,
    type EventTagAccessibility,
    type EventTagAge,
    type EventTagAlcohol,
    type EventTagFood,
    type EventTagSeating,
    type EventTagSetting,
    type EventTagsValue,
    type EventTagVenueType,
} from "@/lib/peerify/event-tags";

type IconMeta = { label: string; icon: LucideIcon };
type IconOption<T extends string> = { value: T; label: string; icon: LucideIcon };

// A Record<Category, IconMeta> per category — keying by the category's own union type means
// adding/removing a value in EVENT_TAG_*_OPTIONS (src/lib/peerify/event-tags.ts) without
// updating the matching icon/label here is a compile error, not a silent missing icon.
const AGE_ICON_META: Record<EventTagAge, IconMeta> = {
    all_ages: { label: "All ages", icon: Users },
    "18_plus": { label: "18+", icon: IdCard },
};

const ALCOHOL_ICON_META: Record<EventTagAlcohol, IconMeta> = {
    byo: { label: "BYO", icon: Backpack },
    served: { label: "Served", icon: Wine },
    not_permitted: { label: "Not permitted", icon: WineOff },
};

const VENUE_TYPE_ICON_META: Record<EventTagVenueType, IconMeta> = {
    home: { label: "Home", icon: Home },
    studio: { label: "Studio", icon: Mic2 },
    local_business: { label: "Local business", icon: Store },
    public_venue: { label: "Public venue", icon: Building2 },
};

const FOOD_ICON_META: Record<EventTagFood, IconMeta> = {
    available: { label: "Food available", icon: UtensilsCrossed },
    byo_snacks: { label: "BYO snacks", icon: ShoppingBag },
};

const SEATING_ICON_META: Record<EventTagSeating, IconMeta> = {
    floor_cushions: { label: "Floor cushions", icon: Sofa },
    seated: { label: "Seated", icon: Armchair },
    standing: { label: "Standing", icon: PersonStanding },
};

const SETTING_ICON_META: Record<EventTagSetting, IconMeta> = {
    indoor: { label: "Indoor", icon: DoorClosed },
    outdoor: { label: "Outdoor", icon: TreePine },
};

const ACCESSIBILITY_ICON_META: Record<EventTagAccessibility, IconMeta> = {
    accessible: { label: "Accessible", icon: Accessibility },
    stairs_involved: { label: "Stairs involved", icon: Footprints },
    not_specified: { label: "Not specified", icon: CircleHelp },
};

const toOptions = <T extends string>(values: readonly T[], meta: Record<T, IconMeta>): IconOption<T>[] =>
    values.map((value) => ({ value, ...meta[value] }));

const AGE_OPTIONS = toOptions(EVENT_TAG_AGE_OPTIONS, AGE_ICON_META);
const ALCOHOL_OPTIONS = toOptions(EVENT_TAG_ALCOHOL_OPTIONS, ALCOHOL_ICON_META);
const VENUE_TYPE_OPTIONS = toOptions(EVENT_TAG_VENUE_TYPE_OPTIONS, VENUE_TYPE_ICON_META);
const FOOD_OPTIONS = toOptions(EVENT_TAG_FOOD_OPTIONS, FOOD_ICON_META);
const SEATING_OPTIONS = toOptions(EVENT_TAG_SEATING_OPTIONS, SEATING_ICON_META);
const SETTING_OPTIONS = toOptions(EVENT_TAG_SETTING_OPTIONS, SETTING_ICON_META);
const ACCESSIBILITY_OPTIONS = toOptions(EVENT_TAG_ACCESSIBILITY_OPTIONS, ACCESSIBILITY_ICON_META);

// Same tint-circle treatment as the action icons in profile-menu.tsx (Button variant="ghost"
// size="icon", h-9 w-9 rounded-full, bg-[#f1f1f1]/hover:bg-[#cecece], no literal border) — here
// re-implemented as a plain <button> (not the shadcn Button) since it needs a selected state and
// a permanent caption underneath, which that component doesn't support. The caption is always
// rendered as visible text, never a hover-only tooltip, matching the mobile-first convention
// already used for icon+label pairs elsewhere (event-detail.tsx, event-timeline.tsx).
const IconTagButton = ({
    selected,
    label,
    icon: Icon,
    onClick,
}: {
    selected: boolean;
    label: string;
    icon: LucideIcon;
    onClick: () => void;
}) => (
    <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className="flex w-[76px] flex-col items-center gap-1.5 rounded-lg px-1 py-2 text-center"
    >
        <span
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                selected
                    ? "bg-[hsl(var(--button-primary))] text-white"
                    : "bg-[#f1f1f1] text-foreground hover:bg-[#cecece]"
            }`}
        >
            <Icon className="h-5 w-5" />
        </span>
        <span
            className={`text-xs leading-tight ${selected ? "font-medium text-foreground" : "text-muted-foreground"}`}
        >
            {label}
        </span>
    </button>
);

const TagCategoryHeading = ({ label, description }: { label: string; description?: string }) => (
    <div>
        <Label className="text-sm font-medium">{label}</Label>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
    </div>
);

// Age/Alcohol/Venue type/Accessibility: radio-button behavior — selecting one option deselects
// any other in the category. Clicking the already-selected option clears it back to unset.
const SingleSelectTagGroup = <T extends string>({
    label,
    description,
    options,
    value,
    onChange,
}: {
    label: string;
    description?: string;
    options: IconOption<T>[];
    value: T | undefined;
    onChange: (value: T | undefined) => void;
}) => (
    <div className="space-y-2">
        <TagCategoryHeading label={label} description={description} />
        <div className="flex flex-wrap gap-1">
            {options.map((option) => (
                <IconTagButton
                    key={option.value}
                    selected={value === option.value}
                    label={option.label}
                    icon={option.icon}
                    onClick={() => onChange(value === option.value ? undefined : option.value)}
                />
            ))}
        </div>
    </div>
);

// Food/Seating/Setting: each option toggles independently.
const MultiSelectTagGroup = <T extends string>({
    label,
    description,
    options,
    values,
    onChange,
}: {
    label: string;
    description?: string;
    options: IconOption<T>[];
    values: T[];
    onChange: (values: T[]) => void;
}) => (
    <div className="space-y-2">
        <TagCategoryHeading label={label} description={description} />
        <div className="flex flex-wrap gap-1">
            {options.map((option) => {
                const selected = values.includes(option.value);
                return (
                    <IconTagButton
                        key={option.value}
                        selected={selected}
                        label={option.label}
                        icon={option.icon}
                        onClick={() =>
                            onChange(selected ? values.filter((v) => v !== option.value) : [...values, option.value])
                        }
                    />
                );
            })}
        </div>
    </div>
);

export interface EventTagsSettingsProps {
    value: EventTagsValue | undefined;
    onChange: (value: EventTagsValue) => void;
}

export function EventTagsSettings({ value, onChange }: EventTagsSettingsProps): React.ReactElement {
    const tags = value || {};

    const setField = <K extends keyof EventTagsValue>(key: K, next: EventTagsValue[K]) => {
        onChange({ ...tags, [key]: next });
    };

    return (
        <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
                Default feature tags shown on new events created under this circle. Each event can still override
                these individually after it&apos;s created.
            </p>

            <div className="grid gap-6 sm:grid-cols-2">
                <SingleSelectTagGroup
                    label="Age"
                    options={AGE_OPTIONS}
                    value={tags.age}
                    onChange={(next) => setField("age", next)}
                />
                <SingleSelectTagGroup
                    label="Alcohol"
                    options={ALCOHOL_OPTIONS}
                    value={tags.alcohol}
                    onChange={(next) => setField("alcohol", next)}
                />
                <SingleSelectTagGroup
                    label="Venue type"
                    options={VENUE_TYPE_OPTIONS}
                    value={tags.venueType}
                    onChange={(next) => setField("venueType", next)}
                />
                <MultiSelectTagGroup
                    label="Food"
                    options={FOOD_OPTIONS}
                    values={tags.food || []}
                    onChange={(next) => setField("food", next.length > 0 ? next : undefined)}
                />
                <MultiSelectTagGroup
                    label="Seating"
                    options={SEATING_OPTIONS}
                    values={tags.seating || []}
                    onChange={(next) => setField("seating", next.length > 0 ? next : undefined)}
                />
                <MultiSelectTagGroup
                    label="Setting"
                    options={SETTING_OPTIONS}
                    values={tags.setting || []}
                    onChange={(next) => setField("setting", next.length > 0 ? next : undefined)}
                />
            </div>

            {/* Accessibility gets its own bordered section rather than sitting in the grid above
                — a tri-state field with real consequences for who can actually attend, not just
                another preference toggle, so it should read as visually distinct. */}
            <div className="rounded-lg border bg-slate-50 p-4">
                <SingleSelectTagGroup
                    label="Accessibility"
                    description="Whether the venue is step-free, involves stairs, or hasn't been assessed yet."
                    options={ACCESSIBILITY_OPTIONS}
                    value={tags.accessibility}
                    onChange={(next) => setField("accessibility", next)}
                />
            </div>
        </div>
    );
}
