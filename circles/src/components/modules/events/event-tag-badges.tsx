import React from "react";
import type { EventTagsValue } from "@/lib/peerify/event-tags";
import {
    ACCESSIBILITY_ICON_META,
    AGE_ICON_META,
    ALCOHOL_ICON_META,
    FOOD_ICON_META,
    SEATING_ICON_META,
    SETTING_ICON_META,
    VENUE_TYPE_ICON_META,
    type EventTagIconMeta,
} from "@/lib/peerify/event-tag-icons";

export type EventTagBadge = EventTagIconMeta & { key: string };

// Single source of truth for "which badges does this event show" — event-detail.tsx (both full
// page and compact/map-popup modes), EventCard (event-timeline.tsx), and MobileEventRow
// (mobile-events-panel.tsx) all call this instead of each re-deriving the list themselves.
//
// "Show only positive tags" falls out of the data model directly: single-select categories are
// optional-empty-or-one-value and multi-select categories are optional-empty-or-array, so an
// unselected category simply has nothing here to push. Accessibility is the one exception —
// "not_specified" is a real stored value but conveys no information, so it's treated the same
// as unset and never produces a badge.
export function getEventTagBadges(tags: EventTagsValue | undefined | null): EventTagBadge[] {
    if (!tags) return [];

    const badges: EventTagBadge[] = [];

    if (tags.age) badges.push({ key: `age:${tags.age}`, ...AGE_ICON_META[tags.age] });
    if (tags.alcohol) badges.push({ key: `alcohol:${tags.alcohol}`, ...ALCOHOL_ICON_META[tags.alcohol] });
    if (tags.venueType) {
        badges.push({ key: `venueType:${tags.venueType}`, ...VENUE_TYPE_ICON_META[tags.venueType] });
    }
    (tags.food || []).forEach((value) => badges.push({ key: `food:${value}`, ...FOOD_ICON_META[value] }));
    (tags.seating || []).forEach((value) => badges.push({ key: `seating:${value}`, ...SEATING_ICON_META[value] }));
    (tags.setting || []).forEach((value) => badges.push({ key: `setting:${value}`, ...SETTING_ICON_META[value] }));
    if (tags.accessibility && tags.accessibility !== "not_specified") {
        badges.push({
            key: `accessibility:${tags.accessibility}`,
            ...ACCESSIBILITY_ICON_META[tags.accessibility],
        });
    }

    return badges;
}

// "outline" matches the existing disclosure/access pills already in these three surfaces (see
// peerify-event-disclosure-display.ts's consumers) — a bordered stone pill with a small neutral
// tint circle, so a new tag badge reads as part of the same badge family rather than a
// competing visual language. "tint" instead mirrors the SELECTED state of the edit-mode picker
// (IconTagButton in event-tags-settings.tsx) for the icon circle only — same size, same solid
// bg-[hsl(var(--button-primary))] fill, same icon size — but stacks a small muted caption below
// it instead of beside it, so a full row of 5+ tags reads as a dense strip rather than a row of
// wide pills. Used only on the event detail page (event-detail.tsx) today; event-timeline.tsx
// and mobile-events-panel.tsx keep "outline" (the default) unchanged.
const BADGE_VARIANT_CLASSES = {
    sm: {
        outline: {
            pill: "inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-stone-700",
            iconWrapper: "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f1f1f1]",
            icon: "h-3 w-3",
            label: "",
        },
        tint: {
            pill: "flex w-16 flex-col items-center gap-1",
            iconWrapper:
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--button-primary))] text-white",
            icon: "h-3.5 w-3.5",
            label: "text-center text-[11px] leading-tight text-muted-foreground",
        },
    },
    // Mobile map-panel row — matches that row's own micro type scale (text-[10px]/text-[12px],
    // px-1.5 py-0.5 on its existing disclosure badges). Only "outline" is used at this size
    // today; "tint" is defined for completeness in case a future caller needs it here too.
    xs: {
        outline: {
            pill: "inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 py-0.5 pl-0.5 pr-2 text-[10px] font-medium text-stone-700",
            iconWrapper: "flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#f1f1f1]",
            icon: "h-2.5 w-2.5",
            label: "",
        },
        tint: {
            pill: "flex w-12 flex-col items-center gap-0.5",
            iconWrapper:
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--button-primary))] text-white",
            icon: "h-2.5 w-2.5",
            label: "text-center text-[10px] leading-tight text-muted-foreground",
        },
    },
} as const;

// Icon + always-visible caption. No hover-only content anywhere: the label is plain text,
// always rendered.
export function EventTagBadgeList({
    tags,
    className = "flex flex-wrap items-center gap-1.5",
    size = "sm",
    variant = "outline",
}: {
    tags: EventTagsValue | undefined | null;
    className?: string;
    size?: keyof typeof BADGE_VARIANT_CLASSES;
    variant?: keyof (typeof BADGE_VARIANT_CLASSES)["sm"];
}): React.ReactElement | null {
    const badges = getEventTagBadges(tags);
    if (badges.length === 0) return null;

    const variantClasses = BADGE_VARIANT_CLASSES[size][variant];

    return (
        <div className={className}>
            {badges.map((badge) => {
                const Icon = badge.icon;
                return (
                    <span key={badge.key} className={variantClasses.pill}>
                        <span className={variantClasses.iconWrapper}>
                            <Icon className={variantClasses.icon} />
                        </span>
                        {variantClasses.label ? (
                            <span className={variantClasses.label}>{badge.label}</span>
                        ) : (
                            badge.label
                        )}
                    </span>
                );
            })}
        </div>
    );
}
