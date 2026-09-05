"use client";

import React from "react";
import { toggleVariants } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge"; // Import Badge for count display
import { Users, User, Calendar, Hammer, Search, HeartHandshake } from "lucide-react";

export interface CategoryFilterProps {
    categories: string[]; // All available categories (e.g., ['circles', 'projects', 'users'])
    categoryCounts: { [key: string]: number }; // Counts for each category
    selectedCategories: string[]; // Empty array means "All"
    onSelectionChange: (selected: string[]) => void;
    hasSearched: boolean;
    displayLabelMap?: { [key: string]: string }; // Optional mapping for presentation labels
}

// Plain buttons, not Radix ToggleGroup: highlighting needs to reflect "is this category
// currently included in selectedCategories" — which can be more than one at once when reached
// via the Advanced Filters multi-select — so a single-select radiogroup (which can only ever
// show exactly one item "on") is the wrong primitive here, even though tapping a pill still
// only ever results in exactly one category being selected (see handlePillTap below). Reuses
// toggleVariants + the exact same data-[state=on]: classes the old ToggleGroupItem relied on,
// just driven by a manually-set data-state attribute instead of Radix's own toggle state, so
// the visual output is unchanged.
const CategoryFilter: React.FC<CategoryFilterProps> = ({
    categories,
    categoryCounts,
    selectedCategories,
    onSelectionChange,
    hasSearched,
    displayLabelMap,
}) => {
    const iconMap: Record<string, React.ReactNode> = {
        all: <Search className="h-4 w-4" />,
        communities: <Users className="h-4 w-4" />,
        users: <User className="h-4 w-4" />,
        events: <Calendar className="h-4 w-4" />,
        projects: <Hammer className="h-4 w-4" />,
        offers: <HeartHandshake className="h-4 w-4" />,
    };

    // Tapping a pill always resets selection to exactly that one category — the same "reset to
    // single category" shortcut the old single-select ToggleGroup gave for free — except for the
    // one case that shortcut also gave for free: tapping the pill that's already the *sole*
    // active category deselects back to "All" (empty array), matching today's exact behavior
    // (Radix's ToggleGroup type="single" returns "" when you click the already-active item).
    const handlePillTap = (category: string) => {
        const isSoleActive = selectedCategories.length === 1 && selectedCategories[0] === category;
        onSelectionChange(isSoleActive ? [] : [category]);
    };

    return (
        <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap" role="group">
            {categories.map((category) => {
                const isActive = selectedCategories.includes(category);
                return (
                    <button
                        key={category}
                        type="button"
                        data-state={isActive ? "on" : "off"}
                        aria-pressed={isActive}
                        onClick={() => handlePillTap(category)}
                        className={cn(
                            toggleVariants({ variant: "outline", size: "sm" }),
                            "flex h-auto min-w-[112px] flex-shrink-0 items-center justify-center gap-2 rounded-full bg-white px-[16px] py-[5px] text-sm capitalize leading-none shadow-sm",
                            "data-[state=on]:bg-[#9cb5f7] data-[state=on]:text-primary",
                            "hover:bg-white",
                        )}
                        aria-label={`Filter by ${displayLabelMap?.[category] ?? category}`}
                    >
                        <span className="text-gray-600">{iconMap[category]}</span>
                        <span>
                            {displayLabelMap?.[category] ?? (category === "communities" ? "circles" : category)}
                        </span>
                        {hasSearched && (
                            <Badge variant="secondary" className="ml-2 rounded-full px-1.5 py-[2px] text-[10px]">
                                {categoryCounts[category] ?? 0}
                            </Badge>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export default CategoryFilter;
