// search-filters.tsx
//
// Extracted from map-explorer.tsx: the Artists/Venues/Events/Offers category pill row, the
// active-genre/offer-type chip strips, and the Advanced Filters trigger + modal (genre, date
// range, physical-only, offer type). Pure props-in/callback-out — nothing here calls
// router.push or touches an Explore-specific jotai atom; the caller (MapExplorer today, a future
// discovery screen tomorrow) owns navigation/atom side effects and decides what to do with a new
// SearchFiltersValue.
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, selectTriggerClassName } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SlidersHorizontal, X, ChevronRight, ChevronLeft, Check } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { tourTeamOfferingTypes } from "@/models/models";
import { PRIMARY_GENRE_OPTIONS } from "@/lib/peerify/artist-profile";
import { getTourTeamOfferingLabel } from "@/lib/data/tour-team-offerings";
import CategoryFilter, { CategoryFilterProps } from "./category-filter";

// ---- Filter shape ----

export const RESULT_TYPE_OPTIONS = [
    { value: "users", label: "Artists" },
    { value: "communities", label: "Venues" },
    { value: "events", label: "Events" },
    { value: "offers", label: "Offers" },
] as const;

export type ResultCategory = (typeof RESULT_TYPE_OPTIONS)[number]["value"];

// Full individual-host set (tourTeamOfferingTypes) plus "custom" — deliberately NOT the narrower
// venue-only subset (VENUE_TOUR_TEAM_OFFERING_TYPES) venues are restricted to in their own
// editor. Offer pins on the map come from both individuals and venues, so the filter's universe
// of options has to cover every type either can produce.
export const OFFER_TYPE_FILTER_OPTIONS = [...tourTeamOfferingTypes, "custom"] as const;
export type OfferTypeFilterOption = (typeof OFFER_TYPE_FILTER_OPTIONS)[number];

export type SearchFiltersValue = {
    selectedCategories: string[];
    selectedGenres: string[];
    selectedOfferTypes: OfferTypeFilterOption[];
    dateRange: DateRange | undefined;
    physicalOnly: boolean;
    // Not read or written by anything in this file — included because it's part of the same
    // conceptual filter shape a caller (e.g. a future discovery screen) will want to persist or
    // pass around together. The free-text search box itself stays owned by the caller.
    searchQuery: string;
};

export type SearchFiltersCategoryCounts = {
    communities: number;
    events: number;
    users: number;
    offers: number;
};

// A plain single-category selection (any one pill tapped, including the default Artists-only
// landing state) is the neutral/"not filtering" shape for Category — exactly like tapping
// between pills has never itself counted as an active filter. Only a genuine deviation from
// that shape — deselected down to "All" (0 selected) or multi-selected via Advanced Filters
// (2-3 selected) — counts, so Clear all doesn't appear just from ordinary pill-tapping.
export const isCategoryFilterActive = (selectedCategories: string[]) => selectedCategories.length !== 1;

export const getActiveSearchFilterCount = (value: SearchFiltersValue): number => {
    let count = 0;
    if (value.dateRange?.from || value.dateRange?.to) count += 1;
    if (value.selectedGenres.length > 0) count += 1;
    if (value.physicalOnly) count += 1;
    if (isCategoryFilterActive(value.selectedCategories)) count += 1;
    if (value.selectedOfferTypes.length > 0) count += 1;
    return count;
};

// ---- Category pill row (Artists/Venues/Events/Offers) ----

export const CategoryFilterCarousel: React.FC<CategoryFilterProps & { className?: string }> = ({ className, ...props }) => {
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const evaluateScrollability = useCallback(() => {
        const el = scrollAreaRef.current;
        if (!el) return;
        const epsilon = 12;
        const remainingLeft = el.scrollLeft;
        const remainingRight = el.scrollWidth - el.clientWidth - el.scrollLeft;
        const nextCanScrollLeft = remainingLeft > epsilon;
        const nextCanScrollRight = remainingRight > epsilon;
        setCanScrollLeft(nextCanScrollLeft);
        setCanScrollRight(nextCanScrollRight);
    }, []);

    const handleArrowClick = useCallback(
        (direction: "left" | "right") => {
            const el = scrollAreaRef.current;
            if (!el) return;
            const amount = Math.max(el.clientWidth * 0.6, 220);
            el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
            window.requestAnimationFrame(evaluateScrollability);
            window.setTimeout(evaluateScrollability, 260);
        },
        [evaluateScrollability],
    );

    useEffect(() => {
        evaluateScrollability();
    }, [
        evaluateScrollability,
        props.categories.length,
        props.selectedCategories,
        props.hasSearched,
        props.categoryCounts,
        props.displayLabelMap,
    ]);

    useEffect(() => {
        const el = scrollAreaRef.current;
        if (!el) return;
        const handleResize = () => evaluateScrollability();
        el.addEventListener("scroll", evaluateScrollability);
        window.addEventListener("resize", handleResize);
        handleResize();
        return () => {
            el.removeEventListener("scroll", evaluateScrollability);
            window.removeEventListener("resize", handleResize);
        };
    }, [evaluateScrollability]);

    return (
        <div className={cn("relative inline-flex min-w-0 items-center", className)}>
            <div
                ref={scrollAreaRef}
                className="no-scrollbar flex max-w-full items-center gap-2 overflow-x-auto overflow-y-hidden mx-0 px-0 md:mx-[22px] md:px-1 scroll-smooth"
            >
                <CategoryFilter {...props} />
            </div>
            <button
                type="button"
                className={cn(
                    "absolute left-2 top-1/2 hidden h-[28px] w-[28px] -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm transition hover:bg-white md:flex",
                    !canScrollLeft && "pointer-events-none opacity-0",
                )}
                onClick={() => handleArrowClick("left")}
                aria-label="Scroll filters left"
            >
                <ChevronLeft className="h-[14px] w-[14px] text-gray-600" />
            </button>
            <button
                type="button"
                className={cn(
                    "absolute right-2 top-1/2 hidden h-[28px] w-[28px] -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm transition hover:bg-white md:flex",
                    !canScrollRight && "pointer-events-none opacity-0",
                )}
                onClick={() => handleArrowClick("right")}
                aria-label="Scroll filters right"
            >
                <ChevronRight className="h-[14px] w-[14px] text-gray-600" />
            </button>
        </div>
    );
};

// ---- Active-filter chip rows ----
// Shared between the below-searchbar summary strip and the modal's own Genre/Offer-type
// sections, so both surfaces (and the dropdowns' checkmarks) can never drift out of sync with
// each other — same component, same props, rendered twice.

export const GenreFilterChips: React.FC<{ selectedGenres: string[]; onRemove: (genre: string) => void }> = ({
    selectedGenres,
    onRemove,
}) => {
    if (selectedGenres.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-2">
            {selectedGenres.map((genre) => (
                <Badge
                    key={genre}
                    variant="secondary"
                    className="flex items-center gap-1 rounded-full bg-white/95 py-1 pl-3 pr-1.5 shadow-sm ring-1 ring-black/5"
                >
                    {genre}
                    <button
                        type="button"
                        onClick={() => onRemove(genre)}
                        className="rounded-full p-0.5 hover:bg-black/10"
                        aria-label={`Remove ${genre} filter`}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </Badge>
            ))}
        </div>
    );
};

export const OfferTypeFilterChips: React.FC<{
    selectedOfferTypes: OfferTypeFilterOption[];
    onRemove: (offerType: OfferTypeFilterOption) => void;
}> = ({ selectedOfferTypes, onRemove }) => {
    if (selectedOfferTypes.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-2">
            {selectedOfferTypes.map((offerType) => (
                <Badge
                    key={offerType}
                    variant="secondary"
                    className="flex items-center gap-1 rounded-full bg-white/95 py-1 pl-3 pr-1.5 shadow-sm ring-1 ring-black/5"
                >
                    {getTourTeamOfferingLabel({ type: offerType, label: undefined })}
                    <button
                        type="button"
                        onClick={() => onRemove(offerType)}
                        className="rounded-full p-0.5 hover:bg-black/10"
                        aria-label={`Remove ${getTourTeamOfferingLabel({ type: offerType, label: undefined })} filter`}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </Badge>
            ))}
        </div>
    );
};

// ---- Advanced Filters trigger + modal ----

export type SearchFiltersProps = {
    value: SearchFiltersValue;
    // Always spreads unchanged fields through from `value` (never rebuilds an untouched array),
    // so a caller can tell which field changed via simple reference inequality — e.g.
    // `next.selectedGenres !== value.selectedGenres` — without deep-comparing. MapExplorer's own
    // genre-triggers-a-server-refetch logic depends on this contract.
    onChange: (next: SearchFiltersValue) => void;
    // Controlled like the underlying Popover/Dialog/Accordion primitives themselves, not folded
    // into SearchFiltersValue — this is modal-open/accordion-section UI state, not a filter value,
    // and the caller (MapExplorer's own "Clear search" reset) needs to be able to force it closed.
    open: boolean;
    onOpenChange: (open: boolean) => void;
    openSection: string;
    onOpenSectionChange: (section: string) => void;
    // useIsMobile() (the hook every caller derives this from) starts out null before the
    // matchMedia listener mounts — treated as falsy everywhere below, same as the original
    // inline isMobile ? ... : ... this replaces.
    isMobile: boolean | null;
};

export const SearchFilters: React.FC<SearchFiltersProps> = ({
    value,
    onChange,
    open,
    onOpenChange,
    openSection,
    onOpenSectionChange,
    isMobile,
}) => {
    const hasDateFilter = Boolean(value.dateRange?.from || value.dateRange?.to);
    const dateLabel = useMemo(() => {
        if (value.dateRange?.from) {
            const from = format(value.dateRange.from, "MMM d, yyyy");
            const to = value.dateRange.to ? format(value.dateRange.to, "MMM d, yyyy") : "Now";
            return `${from} – ${to}`;
        }
        return format(new Date(), "MMM d, yyyy");
    }, [value.dateRange]);
    const includesOffers = value.selectedCategories.length === 0 || value.selectedCategories.includes("offers");
    const activeAdvancedFilterCount = useMemo(() => getActiveSearchFilterCount(value), [value]);

    // The genre dropdown's own Select (Radix) closes itself the instant a window "resize"
    // event fires — confirmed live: dispatching a single resize event closes it within one
    // frame, even though the surrounding Dialog doesn't react to the same event at all, so
    // this is Select-specific (likely its native-picker-dismiss emulation), not a repositioning
    // side effect (position="item-aligned" doesn't avoid it either) or an app-level remount
    // (the trigger/content DOM nodes are the same nodes before and after, only their Radix
    // open-state flips). iOS Safari fires resize events continuously during any scroll gesture
    // as its address bar collapses/expands — including a scroll gesture inside this dropdown's
    // own long (31-item) list — so a long list like this one snaps shut mid-scroll, before a
    // tap can land, while shorter Selects elsewhere in the app never trigger it. Controlled
    // open state + ignoring a close request that arrives within a beat of a resize sidesteps
    // it without touching Radix internals; a genuine dismiss (Escape, outside tap, selecting
    // an item) never immediately follows a resize, so those still close it normally.
    const [genreSelectOpen, setGenreSelectOpen] = useState(false);
    const lastWindowResizeAtRef = useRef(0);
    useEffect(() => {
        const onWindowResize = () => {
            lastWindowResizeAtRef.current = Date.now();
        };
        window.addEventListener("resize", onWindowResize);
        return () => window.removeEventListener("resize", onWindowResize);
    }, []);
    const handleGenreSelectOpenChange = useCallback((nextOpen: boolean) => {
        if (!nextOpen && Date.now() - lastWindowResizeAtRef.current < 250) {
            return;
        }
        setGenreSelectOpen(nextOpen);
    }, []);

    const toggleSelectedCategory = useCallback(
        (category: string) => {
            const prev = value.selectedCategories;
            let nextCategories: string[];
            if (prev.includes(category)) {
                nextCategories = prev.filter((v) => v !== category);
            } else {
                // Checking Offers nudges Artists off by default — the two usually represent
                // different intents (browsing artists to follow vs. browsing anonymous/venue offer
                // pins). Deliberately one-directional (checking Artists must never deselect Offers)
                // and just a default nudge, not a hard restriction: the user can still re-check
                // Artists afterward to view both. Does NOT apply to Venues or Events — only Artists
                // is auto-deselected when Offers is checked.
                const next = category === "offers" ? prev.filter((v) => v !== "users") : prev;
                nextCategories = [...next, category];
            }
            onChange({ ...value, selectedCategories: nextCategories });
        },
        [value, onChange],
    );

    const addSelectedGenre = useCallback(
        (genre: string) => {
            if (value.selectedGenres.includes(genre)) return;
            onChange({ ...value, selectedGenres: [...value.selectedGenres, genre] });
        },
        [value, onChange],
    );
    const removeSelectedGenre = useCallback(
        (genre: string) => {
            onChange({ ...value, selectedGenres: value.selectedGenres.filter((g) => g !== genre) });
        },
        [value, onChange],
    );

    const addSelectedOfferType = useCallback(
        (offerType: OfferTypeFilterOption) => {
            if (value.selectedOfferTypes.includes(offerType)) return;
            onChange({ ...value, selectedOfferTypes: [...value.selectedOfferTypes, offerType] });
        },
        [value, onChange],
    );
    const removeSelectedOfferType = useCallback(
        (offerType: OfferTypeFilterOption) => {
            onChange({ ...value, selectedOfferTypes: value.selectedOfferTypes.filter((t) => t !== offerType) });
        },
        [value, onChange],
    );

    const handleClearAdvancedFilters = useCallback(() => {
        onChange({
            ...value,
            dateRange: undefined,
            selectedGenres: [],
            physicalOnly: false,
            // Back to the same single-category shape the page loads with (Artists only) — the
            // "not active" state per isCategoryFilterActive above, so Clear all correctly
            // disappears again immediately after clicking it, not just for the other three filters.
            selectedCategories: ["users"],
            selectedOfferTypes: [],
        });
    }, [value, onChange]);

    const content = (
        <div className="space-y-3">
            {activeAdvancedFilterCount > 0 && (
                // pr-12: clearance from the mobile Dialog's own circular close button (see its
                // render site), which sits in this same top-right corner — bordered/pill styling
                // (vs. that button's filled circle) keeps the two readable as distinct actions:
                // this one destructive/clearing, that one neutral/closing.
                <div className="flex justify-end pr-12">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-full border-gray-300 px-3 text-xs text-gray-600 hover:bg-gray-50"
                        onClick={handleClearAdvancedFilters}
                    >
                        Clear all
                    </Button>
                </div>
            )}

            <div className="space-y-2 overflow-hidden rounded-[24px] border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-semibold text-gray-900">Category</div>
                {/* Pre-filled with whatever selectedCategories currently holds (including a
                    single entry set by tapping a top pill) and fully bidirectional: editing here
                    updates the same state the pills read, so a pill lights up the instant its
                    type is checked here, with no separate sync step. */}
                <div className="grid grid-cols-3 gap-2">
                    {RESULT_TYPE_OPTIONS.map((option) => {
                        const checked = value.selectedCategories.includes(option.value);
                        return (
                            <label
                                key={option.value}
                                className="flex items-center gap-2 rounded-xl border border-gray-200 p-2.5 text-sm text-gray-900"
                            >
                                <Checkbox checked={checked} onCheckedChange={() => toggleSelectedCategory(option.value)} />
                                {option.label}
                            </label>
                        );
                    })}
                </div>
            </div>

            {includesOffers && (
                <div className="space-y-2 overflow-hidden rounded-[24px] border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="text-sm font-semibold text-gray-900">Offer type</div>
                    <Select value="" onValueChange={(v) => addSelectedOfferType(v as OfferTypeFilterOption)}>
                        <SelectTrigger>
                            <SelectValue
                                placeholder={value.selectedOfferTypes.length > 0 ? "Add another offer type" : "All offer types"}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {/* Same "stay in the list, remove via pills" pattern as the Genre
                                dropdown below. */}
                            {OFFER_TYPE_FILTER_OPTIONS.map((type) => {
                                const isOfferTypeSelected = value.selectedOfferTypes.includes(type);
                                return (
                                    <SelectItem key={type} value={type}>
                                        <span className="flex w-full items-center justify-between gap-2">
                                            {getTourTeamOfferingLabel({ type, label: undefined })}
                                            {isOfferTypeSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                                        </span>
                                    </SelectItem>
                                );
                            })}
                        </SelectContent>
                    </Select>
                    <OfferTypeFilterChips selectedOfferTypes={value.selectedOfferTypes} onRemove={removeSelectedOfferType} />
                </div>
            )}

            {/* Genre applies to Events too, not just Artists — events have no genre field of
                their own, they inherit it from their host circle (getOpenEventsForMap, event.ts),
                and the genre param is already passed to the events fetch above regardless of
                which category is selected. Venues never carry primaryGenres (no genre UI for
                them, saveAbout's venue branch never writes it), so Venues-only correctly excludes
                this section. */}
            {(value.selectedCategories.length === 0 ||
                value.selectedCategories.includes("users") ||
                value.selectedCategories.includes("events")) && (
                <div className="space-y-2 overflow-hidden rounded-[24px] border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="text-sm font-semibold text-gray-900">Genre</div>
                    <Select
                        value=""
                        onValueChange={(v) => addSelectedGenre(v)}
                        open={genreSelectOpen}
                        onOpenChange={handleGenreSelectOpenChange}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder={value.selectedGenres.length > 0 ? "Add another genre" : "All genres"} />
                        </SelectTrigger>
                        <SelectContent>
                            {/* Selected genres stay in the list (not filtered out) so their checkmark
                                is visible while scrolling/browsing — removal happens via the pills
                                below, not by re-tapping here (addSelectedGenre already no-ops on an
                                already-selected value, so tapping one here is harmless either way). */}
                            {PRIMARY_GENRE_OPTIONS.map((option) => {
                                const isGenreSelected = value.selectedGenres.includes(option);
                                return (
                                    <SelectItem key={option} value={option}>
                                        <span className="flex w-full items-center justify-between gap-2">
                                            {option}
                                            {isGenreSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                                        </span>
                                    </SelectItem>
                                );
                            })}
                        </SelectContent>
                    </Select>
                    <GenreFilterChips selectedGenres={value.selectedGenres} onRemove={removeSelectedGenre} />
                </div>
            )}

            {(value.selectedCategories.length === 0 || value.selectedCategories.includes("events")) && (
                <div className="flex items-center justify-between gap-2 overflow-hidden rounded-[24px] border border-gray-200 bg-white p-4 shadow-sm">
                    <Label htmlFor="physicalOnly" className="text-sm font-semibold text-gray-900">
                        Physical events only
                    </Label>
                    <Switch
                        id="physicalOnly"
                        checked={value.physicalOnly}
                        onCheckedChange={(checked) => onChange({ ...value, physicalOnly: checked })}
                    />
                </div>
            )}

            {/* Relevant to every category: Artists/Venues get their createdAt (join date) filtered
                by dateRange (see drawerListData and the displayedContent effect's withinDateRange
                calls), Events get filtered by actual event date, and Offers has no date data yet
                (OfferMapPin carries no date field) but stays visible in anticipation of a future
                date-availability feature for it — not because it currently filters anything for
                that category. */}
            {(value.selectedCategories.length === 0 ||
                value.selectedCategories.includes("users") ||
                value.selectedCategories.includes("communities") ||
                value.selectedCategories.includes("events") ||
                value.selectedCategories.includes("offers")) && (
                <Accordion
                    type="single"
                    collapsible
                    value={openSection}
                    onValueChange={(v) => onOpenSectionChange(v)}
                    className="space-y-3"
                >
                    <AccordionItem
                        className="overflow-hidden rounded-[24px] border border-gray-200 bg-white px-0 shadow-sm"
                        value="calendar"
                    >
                        <div className="space-y-2 p-4">
                            <div className="text-sm font-semibold text-gray-900">Calendar</div>
                            <AccordionTrigger className={cn(selectTriggerClassName, "hover:no-underline")}>
                                <span className="truncate text-left">{hasDateFilter ? dateLabel : "Select dates"}</span>
                            </AccordionTrigger>
                        </div>
                        <AccordionContent className="px-4 pb-4 pt-0">
                            <div className="space-y-4">
                                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                                    <Calendar
                                        mode="range"
                                        selected={value.dateRange}
                                        onSelect={(next) => onChange({ ...value, dateRange: next as DateRange | undefined })}
                                        numberOfMonths={1}
                                        defaultMonth={value.dateRange?.from ?? new Date()}
                                        className="mx-auto"
                                    />
                                </div>
                                {hasDateFilter && (
                                    <div className="flex justify-end">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 rounded-full px-3 text-xs text-gray-600"
                                            onClick={() => onChange({ ...value, dateRange: undefined })}
                                        >
                                            Clear date
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            )}
        </div>
    );

    return (
        <>
            {isMobile ? (
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="relative ml-1 h-9 w-9 rounded-full p-0"
                    onClick={() => onOpenChange(true)}
                    aria-label="Open advanced search"
                >
                    <SlidersHorizontal className="h-4 w-4" />
                    {activeAdvancedFilterCount > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium leading-none text-primary-foreground">
                            {activeAdvancedFilterCount}
                        </span>
                    )}
                </Button>
            ) : (
                <Popover open={open} onOpenChange={onOpenChange}>
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="relative ml-1 h-9 w-9 rounded-full p-0"
                            aria-label="Open advanced search"
                        >
                            <SlidersHorizontal className="h-4 w-4" />
                            {activeAdvancedFilterCount > 0 && (
                                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium leading-none text-primary-foreground">
                                    {activeAdvancedFilterCount}
                                </span>
                            )}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="start"
                        sideOffset={10}
                        className="w-[min(27rem,calc(100vw-2rem))] overflow-hidden rounded-[26px] border border-gray-200/80 bg-[#faf9f7] p-3 shadow-2xl"
                    >
                        {content}
                    </PopoverContent>
                </Popover>
            )}
            {isMobile && (
                <Dialog open={open} onOpenChange={onOpenChange}>
                    <DialogContent
                        hideClose
                        className="top-auto left-0 right-0 bottom-0 max-h-[85vh] max-w-none translate-x-0 translate-y-0 rounded-t-[28px] rounded-b-none border-0 p-0 sm:rounded-t-[28px]"
                    >
                        <DialogHeader className="sr-only">
                            <DialogTitle>Search filters</DialogTitle>
                        </DialogHeader>
                        {/* Own circular close button (matching the UserToolbox close button's style)
                            instead of the Dialog's plain default — kept visually distinct from
                            "Clear all" above, which sits close to it in the same corner. */}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-4 top-4 z-10 h-8 w-8 rounded-full bg-gray-100 hover:bg-gray-200"
                            onClick={() => onOpenChange(false)}
                            aria-label="Close filters"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                        <div className="max-h-[calc(85vh-5rem)] overflow-y-auto bg-[#faf9f7] px-5 pb-6 pt-4">{content}</div>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
};

export default SearchFilters;
