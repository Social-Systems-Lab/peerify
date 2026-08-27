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

const BADGE_SIZE_CLASSES = {
    // Event detail page and the timeline card — same footprint as the existing disclosure/
    // access pills there (text-xs, px-2 py-0.5 elsewhere in those files).
    sm: {
        pill: "inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-stone-700",
        iconWrapper: "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f1f1f1]",
        icon: "h-3 w-3",
    },
    // Mobile map-panel row — matches that row's own micro type scale (text-[10px]/text-[12px],
    // px-1.5 py-0.5 on its existing disclosure badges).
    xs: {
        pill: "inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 py-0.5 pl-0.5 pr-2 text-[10px] font-medium text-stone-700",
        iconWrapper: "flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#f1f1f1]",
        icon: "h-2.5 w-2.5",
    },
} as const;

// Small tint-circle icon + always-visible caption, wrapped in the same rounded-full pill shape
// the existing disclosure/access badges already use in these three surfaces (see
// peerify-event-disclosure-display.ts's consumers) — reads as part of the same badge family
// rather than a competing visual language, while still carrying Phase 2/3's icon treatment
// (profile-menu.tsx tint circle) at a size that fits inline card/row contexts. No hover-only
// content anywhere: the label is plain text, always rendered.
export function EventTagBadgeList({
    tags,
    className = "flex flex-wrap items-center gap-1.5",
    size = "sm",
}: {
    tags: EventTagsValue | undefined | null;
    className?: string;
    size?: keyof typeof BADGE_SIZE_CLASSES;
}): React.ReactElement | null {
    const badges = getEventTagBadges(tags);
    if (badges.length === 0) return null;

    const sizeClasses = BADGE_SIZE_CLASSES[size];

    return (
        <div className={className}>
            {badges.map((badge) => {
                const Icon = badge.icon;
                return (
                    <span key={badge.key} className={sizeClasses.pill}>
                        <span className={sizeClasses.iconWrapper}>
                            <Icon className={sizeClasses.icon} />
                        </span>
                        {badge.label}
                    </span>
                );
            })}
        </div>
    );
}
