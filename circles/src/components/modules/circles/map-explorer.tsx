// map-explorer.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, WithMetric, Content, ContentPreviewData, MemberDisplay, OfferMapPin } from "@/models/models";
import { useIsMobile } from "@/components/utils/use-is-mobile";
import { useDebounce } from "@/components/utils/use-debounce";
import useWindowDimensions from "@/components/utils/use-window-dimensions";
import { motion } from "framer-motion";
import CircleSwipeCard from "./circle-swipe-card";
import { MapDisplay } from "@/components/map/map";
import { Button } from "@/components/ui/button";
import { Hand, Home, Search, X, Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { MdOutlineTravelExplore } from "react-icons/md";
import { HiChevronRight, HiMiniSquare2Stack } from "react-icons/hi2";
import { useAtom } from "jotai";
import {
    userAtom,
    zoomContentAtom,
    displayedContentAtom,
    contentPreviewAtom,
    sidePanelContentVisibleAtom, // Import contentPreviewAtom
    sidePanelModeAtom,
    sidePanelSearchStateAtom,
    mapSearchCommandAtom,
    drawerContentAtom,
    mobileExploreAvatarSlotAtom,
    mobileExploreSearchFocusedAtom,
} from "@/lib/data/atoms";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { CirclePicture } from "./circle-picture";
import { completeSwipeOnboardingAction } from "./swipe-actions";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { searchContentAction } from "../search/actions";
import SearchFilters, {
    SearchFiltersValue,
    CategoryFilterCarousel,
    GenreFilterChips,
    OfferTypeFilterChips,
    RESULT_TYPE_OPTIONS,
    OfferTypeFilterOption,
    getActiveSearchFilterCount,
} from "../search/search-filters";
import Indicators from "@/components/utils/indicators";
import ResizingDrawer from "@/components/ui/resizing-drawer"; // Correct import name
import ContentPreview from "@/components/layout/content-preview";
import { getOpenEventsForMapAction, getOfferMapPinsAction } from "./map-explorer-actions";
import { EventDisplay } from "@/models/models";
import ActivityPanel from "@/components/layout/activity-panel";
import MobileEventsPanel from "@/components/modules/events/mobile-events-panel";
import { isPeerifyArtistIdentity, isPeerifyVenueIdentity } from "@/lib/peerify/artist-profile";

// mapItemToContent helper remains the same
const mapItemToContent = (item: WithMetric<Content> | Circle | undefined): Content | null => {
    // ... (no changes) ...
    if (!item) return null;
    if ("metrics" in item && item.metrics) {
        const { metrics, ...contentData } = item;
        return {
            ...contentData,
            metrics: {
                similarity: metrics.similarity,
                searchRank: metrics.searchRank,
            },
        } as Content;
    }
    if ("circleType" in item || "type" in item) {
        return { ...item, metrics: {} } as Content;
    }
    console.warn("Unmappable item type in mapItemToContent:", item);
    return null;
};

// Small deterministic radial jitter applied only when multiple Offer pins share the exact same
// (rounded) coordinate — e.g. one host with several offer types. Without this they'd render as
// pixel-perfect stacked markers (map.tsx has no clustering/de-densification of any kind — every
// pin type is a plain absolutely-positioned DOM element with no native Mapbox clustering layer).
// This is deliberately NOT general density/clustering: pins that are merely nearby (not at the
// identical coordinate) are left untouched. Real Mapbox-native clustering is a known future need
// once offer density grows past single digits (current staging scale) — logged separately, not
// part of this pass. Produces new location objects rather than mutating in place, since multiple
// offerings from the same circle currently share one `location` object reference (see
// getOfferMapPins's flatten step) — mutating one pin's coordinate would silently move every
// sibling offering's pin too.
//
// Venue-identity pins (circleHandle present — see OfferMapPin, models.ts) are excluded from
// jittering entirely, grouping and displacement alike — confirmed live on prod: The Armchair (2
// co-located offerings) had both its offer pins visibly displaced ~60-70m from its own true,
// unjittered location, read as "different building" from the venue's own profile pin. That
// mismatch never existed for anonymous pins, which have no comparable fixed reference point to
// look inconsistent against; a venue's offer pins do, so they stay exactly at the real
// coordinate. Anonymous pins that happen to share a coordinate with a venue are still jittered
// among themselves — only the venue's own pins are excluded from the grouping.
const SAME_COORDINATE_JITTER_DEGREES = 0.0006; // ~60-70m at the equator — visibly separates pins while staying "at this location"

function jitterSameCoordinateOfferPins(pins: OfferMapPin[]): OfferMapPin[] {
    const groups = new Map<string, OfferMapPin[]>();
    for (const pin of pins) {
        if (pin.circleHandle) continue;
        const lngLat = pin.location?.lngLat;
        if (!lngLat) continue;
        const key = `${lngLat.lng.toFixed(5)},${lngLat.lat.toFixed(5)}`;
        const group = groups.get(key);
        if (group) group.push(pin);
        else groups.set(key, [pin]);
    }

    return pins.map((pin) => {
        if (pin.circleHandle) return pin;
        const lngLat = pin.location?.lngLat;
        if (!lngLat) return pin;
        const key = `${lngLat.lng.toFixed(5)},${lngLat.lat.toFixed(5)}`;
        const group = groups.get(key)!;
        if (group.length <= 1) return pin;

        const angle = (2 * Math.PI * group.indexOf(pin)) / group.length;
        return {
            ...pin,
            location: {
                ...pin.location!,
                lngLat: {
                    lng: lngLat.lng + SAME_COORDINATE_JITTER_DEGREES * Math.cos(angle),
                    lat: lngLat.lat + SAME_COORDINATE_JITTER_DEGREES * Math.sin(angle),
                },
            },
        };
    });
}

// Counterpart to jitterSameCoordinateOfferPins above, for the pins that function deliberately
// excludes: instead of spatially separating co-located venue offerings (which would recreate the
// exact "different building" mismatch that exclusion was built to fix), merge them into one
// marker at the venue's true coordinate, carrying the full offering list for the marker's count
// badge and the click-preview's list (see map.tsx/crew-offer-map-preview.tsx). Grouped by
// (circleHandle, rounded coordinate) rather than coordinate alone, so two different venues that
// happen to round to the same coordinate are never merged into one marker.
//
// Every identity pin gets a groupedOfferings array, even a lone one (length 1) — callers check
// `.length > 1` uniformly rather than treating "absent" and "singleton" as different shapes to
// special-case. Anonymous pins are untouched, unaffected by this function entirely.
//
// _id is `${circleHandle}:group`, independent of which specific offerings are currently included
// — stable across an offer-type filter change (see the caller: this must run AFTER filtering, not
// once at fetch time, or a merged marker's badge would show the venue's total offering count
// instead of what's actually visible under the active filter). A stable id lets map.tsx reuse the
// same marker DOM element across a filter change instead of destroying/recreating it; see that
// file's existing-marker branch for the accompanying face-content refresh this requires.
function groupIdentityOfferPins(pins: OfferMapPin[]): OfferMapPin[] {
    const anonymous: OfferMapPin[] = [];
    const groups = new Map<string, OfferMapPin[]>();
    for (const pin of pins) {
        if (!pin.circleHandle) {
            anonymous.push(pin);
            continue;
        }
        const lngLat = pin.location?.lngLat;
        const key = lngLat ? `${pin.circleHandle}:${lngLat.lng.toFixed(5)},${lngLat.lat.toFixed(5)}` : pin.circleHandle;
        const group = groups.get(key);
        if (group) group.push(pin);
        else groups.set(key, [pin]);
    }

    const grouped: OfferMapPin[] = Array.from(groups.values()).map((group) => {
        const first = group[0];
        return {
            ...first,
            _id: `${first.circleHandle}:group`,
            groupedOfferings: group.map((pin) => ({ offerType: pin.offerType, offerLabel: pin.offerLabel })),
        };
    });

    return [...anonymous, ...grouped];
}

interface MapExplorerProps {
    allDiscoverableCircles: WithMetric<Circle>[];
    mapboxKey: string;
}

type ViewMode = "cards" | "explore";

// Define snap point indices for clarity
const SNAP_INDEX_CLOSED = -1; // Not used by resizing drawer, but conceptually useful
const SNAP_INDEX_PEEK = 0; // Smallest height (e.g., 100px)
const SNAP_INDEX_HALF = 1; // Medium height (e.g., 40%)
const SNAP_INDEX_OPEN = 2; // Large height (e.g., 80%)
const SNAP_INDEX_FULL = 3; // Full height (e.g., 100%)

const SEARCH_CATEGORY_LABELS: Record<string, string> = {
    users: "artists",
    communities: "venues",
    events: "events",
    offers: "offers",
};

// Empty array (or omitted) means "All" throughout this file — mirrors selectedCategories'
// own empty-means-All convention, not a separate falsy-value convention.
const getSearchCategoriesLabel = (categories: string[]) => {
    if (categories.length === 0) return "results";
    return categories.map((category) => SEARCH_CATEGORY_LABELS[category] ?? category).join(" & ");
};

const buildSearchEmptyState = ({
    hasSearched,
    query,
    selectedCategories,
    dateLabel,
    hasDateFilter,
}: {
    hasSearched: boolean;
    query: string;
    selectedCategories: string[];
    dateLabel: string;
    hasDateFilter: boolean;
}) => {
    if (!hasSearched) {
        return {
            title: "No circles in this view yet",
            description: "Try a different result type or loosen the active filters.",
        };
    }

    const trimmedQuery = query.trim();
    const context: string[] = [];

    if (trimmedQuery) {
        context.push(`for "${trimmedQuery}"`);
    }

    if (selectedCategories.length > 0) {
        context.push(`in ${getSearchCategoriesLabel(selectedCategories)}`);
    }

    if (hasDateFilter) {
        context.push(`inside ${dateLabel}`);
    }

    return {
        title: `No ${getSearchCategoriesLabel(selectedCategories)} found`,
        description:
            context.length > 0
                ? `Nothing matched ${context.join(" ")}. Try widening a filter or switching result types.`
                : "Try a broader query or remove a filter.",
    };
};

export const MapExplorer: React.FC<MapExplorerProps> = ({ allDiscoverableCircles, mapboxKey }) => {
    // --- State ---
    const [currentIndex, setCurrentIndex] = useState(0);
    const [user, setUser] = useAtom(userAtom);
    const [, setZoomContent] = useAtom(zoomContentAtom);
    const [displayedContent, setDisplayedContent] = useAtom(displayedContentAtom);
    const [contentPreview, setContentPreview] = useAtom(contentPreviewAtom); // Get value and setter
    const isMobile = useIsMobile();
    const { windowHeight } = useWindowDimensions();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [viewMode, setViewMode] = useState<ViewMode>("explore");
    const [searchQuery, setSearchQuery] = useState("");
    // Empty array means "All" (today's default is a single-element array, the equivalent of the
    // old selectedCategory === "users" default). This is the actual source of truth for both map
    // pins and results — the top Artists/Venues/Events pills are a "reset to exactly one" shortcut
    // into this same state, not a separate concept (see setSelectedCategories usage below).
    const [selectedCategories, setSelectedCategories] = useState<string[]>(["users"]);
    // Shared by the displayed-content effect below and the Offer-type filter UI — unlike Genre,
    // which renders unconditionally regardless of category (see map-explorer's own investigation
    // notes on that inconsistency, left as-is), the Offer-type picker only makes sense while Offer
    // pins are actually part of the current view.
    const includesOffers = selectedCategories.length === 0 || selectedCategories.includes("offers");
    const [allSearchResults, setAllSearchResults] = useState<WithMetric<Circle>[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [openAdvancedSection, setOpenAdvancedSection] = useState<string>("");
    const [drawerContent, setDrawerContent] = useAtom(drawerContentAtom);
    // Events dataset for map
    const [eventsForMap, setEventsForMap] = useState<EventDisplay[]>([]);
    const [isEventsLoading, setIsEventsLoading] = useState(false);
    // Offer pins — one per individual offer, not per circle (see getOfferMapPins) — a separate
    // dataset from allDiscoverableCircles/baseCircles (unlike events, which are always a separate
    // dataset merged in below), fetched once since it has no date/genre filters of its own to
    // react to. Carries no circle identity at all, so it's never routed through
    // mapItemToContent (which expects circle-shaped data) — merged in directly, like events.
    const [offerMapPins, setOfferMapPins] = useState<OfferMapPin[]>([]);
    const [pendingFocusEventId, setPendingFocusEventId] = useState<string | null>(searchParams.get("focusEvent"));
    const [hasAppliedFocusEvent, setHasAppliedFocusEvent] = useState(false);
    // Opt-in filter to exclude virtual events — off by default, matching the "show everything by
    // default" behavior the map feed fix above establishes. Applied client-side since it's a pure
    // boolean check on data already fetched, same as the search-query filter just below.
    const [physicalOnly, setPhysicalOnly] = useState<boolean>(false);
    const filteredEventsForMap = useMemo(() => {
        let list = eventsForMap;
        if (physicalOnly) {
            list = list.filter((e) => !e.isVirtual);
        }
        if (hasSearched && searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            list = list.filter(
                (e) =>
                    (e.title && e.title.toLowerCase().includes(q)) ||
                    (e.description && e.description.toLowerCase().includes(q)),
            );
        }
        return list;
    }, [eventsForMap, hasSearched, searchQuery, physicalOnly]);
    // Date range filter
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const dateLabel = useMemo(() => {
        if (dateRange?.from) {
            const from = format(dateRange.from, "MMM d, yyyy");
            const to = dateRange.to ? format(dateRange.to, "MMM d, yyyy") : "Now";
            return `${from} – ${to}`;
        }
        return format(new Date(), "MMM d, yyyy");
    }, [dateRange]);
    const hasDateFilter = Boolean(dateRange?.from || dateRange?.to);
    // Primary genre filter — a real server-side query param, unlike the client-side date/category filters.
    // Multi-select: matches circles with ANY of the selected genres (Mongo $in overlap), no maximum here.
    const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
    // Distinguishes a pill click (and handleClearAdvancedFilters, which reuses this same
    // flag) from handleClearSearch, which performs its own synchronous full reset and
    // shouldn't also fire the debounced live-search effect below.
    const genrePillChangedRef = useRef(false);

    // Offer-type filter — client-side only, unlike selectedGenres above: offerMapPins is fetched
    // once, unfiltered, in its own effect (see that effect's comment) rather than re-queried per
    // filter change, so there's no server round-trip to trigger here. Multi-select, same "matches
    // ANY of the selected types" semantics as Genre. No ref/flag mirroring genrePillChangedRef is
    // needed since nothing needs to be told to re-fetch.
    const [selectedOfferTypes, setSelectedOfferTypes] = useState<OfferTypeFilterOption[]>([]);

    // Bridges SearchFilters' clean value/onChange contract into this screen's existing
    // individual useState hooks (kept separate rather than folded into one object, since dozens
    // of other effects/memos below already depend on each of these independently) plus the
    // atom-driven side effects (router.push, sidePanelMode, etc.) SearchFilters itself must never
    // touch directly.
    const filtersValue: SearchFiltersValue = useMemo(
        () => ({ selectedCategories, selectedGenres, selectedOfferTypes, dateRange, physicalOnly, searchQuery }),
        [selectedCategories, selectedGenres, selectedOfferTypes, dateRange, physicalOnly, searchQuery],
    );
    const handleFiltersChange = useCallback(
        (next: SearchFiltersValue) => {
            // SearchFilters always spreads unchanged fields through from the value it was given,
            // so a new selectedGenres array reference here means genre specifically changed —
            // mirrors addSelectedGenre/removeSelectedGenre/handleClearAdvancedFilters' previous
            // direct sets of this same ref before the Advanced Filters modal was extracted.
            if (next.selectedGenres !== selectedGenres) {
                genrePillChangedRef.current = true;
            }
            setSelectedCategories(next.selectedCategories);
            setSelectedGenres(next.selectedGenres);
            setSelectedOfferTypes(next.selectedOfferTypes);
            setDateRange(next.dateRange);
            setPhysicalOnly(next.physicalOnly);
        },
        [selectedGenres],
    );

    const withinDateRange = useCallback(
        (d?: Date | string) => {
            if (!dateRange?.from && !dateRange?.to) return true;
            if (!d) return false;
            const dt = typeof d === "string" ? new Date(d) : d;
            const fromT = dateRange.from ? new Date(dateRange.from).setHours(0, 0, 0, 0) : undefined;
            const toT = dateRange.to ? new Date(dateRange.to).setHours(23, 59, 59, 999) : Date.now();
            const t = dt.getTime();
            return (fromT ? t >= fromT : true) && t <= (toT as number);
        },
        [dateRange],
    );

    // State to control the drawer's active snap index
    const [isMounted, setIsMounted] = useState(false);
    const [showSwipeInstructions, setShowSwipeInstructions] = useState(false);
    const [triggerSnapIndex, setTriggerSnapIndex] = useState<number>(-1);
    // Tracks the drawer's last known snap index so onSnapChange can detect a downward swipe
    // regardless of which index it lands on (a single swipe only moves one snap level, but the
    // preview opens two levels above the bottom, so requiring an exact landing on the bottom index
    // meant one swipe-down only shrank the sheet without dismissing the preview underneath).
    const prevSnapIndexRef = useRef<number>(SNAP_INDEX_PEEK);
    const [sidePanelContentVisible] = useAtom(sidePanelContentVisibleAtom);
    const [panelMode, setSidePanelMode] = useAtom(sidePanelModeAtom);
    const [, setSearchPanelState] = useAtom(sidePanelSearchStateAtom);
    const [mapSearchCommand] = useAtom(mapSearchCommandAtom);
    const [, setMobileExploreAvatarSlot] = useAtom(mobileExploreAvatarSlotAtom);
    // Stable identity so React doesn't null-then-reset the atom on every re-render
    // (an inline ref callback's identity changes every render, which would do that).
    const mobileExploreAvatarSlotRef = useCallback(
        (node: HTMLDivElement | null) => setMobileExploreAvatarSlot(node),
        [setMobileExploreAvatarSlot],
    );
    const [, setMobileExploreSearchFocused] = useAtom(mobileExploreSearchFocusedAtom);
    const [lastSearchCmdTs, setLastSearchCmdTs] = useState<number>(-1);

    // --- Memos ---
    const snapPoints = useMemo(() => [100, windowHeight * 0.4, windowHeight * 0.8, windowHeight], [windowHeight]);

    const filterCirclesByCategory = useCallback((circles: WithMetric<Circle>[], categories: string[]) => {
        // Empty array means "All" — unfiltered, same as the old null/falsy category.
        if (categories.length === 0) return circles;
        // No circle document represents an event — events live in a separate dataset
        // (eventsForMap/filteredEventsForMap) entirely, so an "events"-only selection (no other
        // type alongside it) should never match any circle. OR-matches across every non-"events"
        // type selected, so e.g. ["users", "communities"] returns artists AND venues together.
        const nonEventTypes = categories.filter((category) => category !== "events");
        if (nonEventTypes.length === 0) return [];
        return circles.filter((circle) =>
            nonEventTypes.some((category) =>
                category === "users"
                    ? isPeerifyArtistIdentity(circle)
                    : category === "communities"
                      ? isPeerifyVenueIdentity(circle)
                      : false,
            ),
        );
    }, []);

    const displayedSwipeCircles = useMemo(() => {
        // ... (no changes) ...
        if (!user) return [];
        const userFollowedIds = (user.memberships || []).map((m) => m.circleId);
        const userPendingIds = (user.pendingRequests || []).map((r) => r.circleId);
        const userIgnoredIds = user.ignoredCircles || [];
        return allDiscoverableCircles.filter(
            (circle) =>
                !userFollowedIds.includes(circle._id) &&
                !userPendingIds.includes(circle._id) &&
                !userIgnoredIds.includes(circle._id),
        );
    }, [allDiscoverableCircles, user]);

    const filteredSearchResults = useMemo(() => {
        return filterCirclesByCategory(allSearchResults, selectedCategories);
    }, [allSearchResults, selectedCategories, filterCirclesByCategory]);

    // What the search results list/panel should actually show: filteredSearchResults is already
    // correctly scoped to whichever circle types are selected (or every type, if none are) via
    // filterCirclesByCategory — only events need handling here explicitly, since they're a
    // separate dataset filterCirclesByCategory never touches. "All" (empty array) always
    // includes events, same as today.
    const searchDisplayItems = useMemo(() => {
        const includesEvents = selectedCategories.length === 0 || selectedCategories.includes("events");
        return [...filteredSearchResults, ...(includesEvents ? filteredEventsForMap : [])];
    }, [selectedCategories, filteredSearchResults, filteredEventsForMap]);

    const searchEmptyState = useMemo(
        () =>
            buildSearchEmptyState({
                hasSearched,
                query: searchQuery,
                selectedCategories,
                dateLabel,
                hasDateFilter,
            }),
        [hasSearched, searchQuery, selectedCategories, dateLabel, hasDateFilter],
    );

    const countsDatasetCircles = useMemo(() => {
        return hasSearched ? allSearchResults : allDiscoverableCircles;
    }, [hasSearched, allSearchResults, allDiscoverableCircles]);

    const categoryCounts = useMemo(() => {
        // Include events count from filteredEventsForMap
        const counts: { [key: string]: number } = {
            communities: 0,
            projects: 0,
            users: 0,
            events: filteredEventsForMap.length,
            // Now counts individual offers, not people-with-offers — a person with 3 offer types
            // contributes 3 here, which is the correct reading once pins are per-offer. Reflects
            // selectedOfferTypes the same way this count already reflects selectedGenres via
            // countsDatasetCircles below (genre is baked into the fetched results) — otherwise
            // this number would silently stop matching what's actually shown on the map/list the
            // moment an offer-type filter is active.
            offers:
                selectedOfferTypes.length === 0
                    ? offerMapPins.length
                    : offerMapPins.filter((pin) => selectedOfferTypes.includes(pin.offerType)).length,
        };
        countsDatasetCircles?.forEach((result) => {
            if (isPeerifyVenueIdentity(result)) counts.communities++;
            else if (isPeerifyArtistIdentity(result)) counts.users++;
        });
        return counts;
    }, [countsDatasetCircles, filteredEventsForMap.length, offerMapPins, selectedOfferTypes]);

    // Used only by this screen's own search-bar "Clear search" button visibility below — the
    // Advanced Filters trigger badge/count now lives inside SearchFilters itself, computed the
    // same way from the same filtersValue.
    const activeAdvancedFilterCount = useMemo(() => getActiveSearchFilterCount(filtersValue), [filtersValue]);

    useEffect(() => {
        if (!hasSearched) {
            return;
        }

        setSearchPanelState({
            query: searchQuery,
            isSearching,
            hasSearched,
            selectedCategories,
            selectedDateLabel: hasDateFilter ? dateLabel : null,
            items: searchDisplayItems as any,
            counts: {
                communities: categoryCounts.communities,
                projects: categoryCounts.projects,
                users: categoryCounts.users,
                events: filteredEventsForMap.length,
            },
        });
    }, [
        hasSearched,
        searchQuery,
        isSearching,
        selectedCategories,
        hasDateFilter,
        dateLabel,
        searchDisplayItems,
        filteredEventsForMap,
        categoryCounts,
        setSearchPanelState,
    ]);

    // Determine data source for the drawer list
    // Base circles used for map/list before mapping to Content
    const baseCircles = useMemo(() => {
        if (hasSearched) {
            return filteredSearchResults;
        } else {
            return filterCirclesByCategory(allDiscoverableCircles, selectedCategories);
        }
    }, [hasSearched, filteredSearchResults, allDiscoverableCircles, selectedCategories, filterCirclesByCategory]);

    const drawerListData = useMemo(() => {
        let list = baseCircles;
        if (dateRange?.from || dateRange?.to) {
            list = list.filter((c) => withinDateRange((c as any).createdAt));
        }
        return list;
    }, [baseCircles, dateRange, withinDateRange]);

    // Sectioned mobile drawer view (per Category type), mirroring search-results-panel.tsx's
    // desktop grouping. drawerListData is already circle-type-scoped via filterCirclesByCategory
    // (baseCircles) — this just splits it into the three named buckets rather than one flat
    // list, plus events, which drawerListData never carried at all before (it comes from the
    // separate filteredEventsForMap dataset, included whenever "events" is selected or nothing
    // is, same rule searchDisplayItems/the map-markers effect already use).
    const drawerSections = useMemo(() => {
        const includesEvents = selectedCategories.length === 0 || selectedCategories.includes("events");
        const artists: WithMetric<Circle>[] = [];
        const venues: WithMetric<Circle>[] = [];
        const other: WithMetric<Circle>[] = [];
        drawerListData.forEach((circle) => {
            if (isPeerifyVenueIdentity(circle)) venues.push(circle);
            else if (isPeerifyArtistIdentity(circle)) artists.push(circle);
            else other.push(circle);
        });
        return { artists, venues, events: includesEvents ? filteredEventsForMap : [], other };
    }, [drawerListData, filteredEventsForMap, selectedCategories]);
    const drawerHasResults =
        drawerSections.artists.length > 0 ||
        drawerSections.venues.length > 0 ||
        drawerSections.events.length > 0 ||
        drawerSections.other.length > 0;

    // --- Callbacks ---
    const handleSwiped = useCallback((circle: Circle, direction: "left" | "right") => {
        setCurrentIndex((prev) => prev + 1);
    }, []);

    const handleSetZoomContent = useCallback(
        (item: WithMetric<Circle> | Circle | undefined) => {
            // ... (no changes) ...
            if (!item) {
                setZoomContent(undefined);
                return;
            }
            const mappedItem = mapItemToContent(item);
            if (mappedItem) {
                setZoomContent(mappedItem);
            } else {
                console.warn("Could not map item for zooming:", item);
                setZoomContent(undefined);
            }
        },
        [setZoomContent],
    );

    const handleSearchTrigger = useCallback(async (options?: { preserveActiveCategory?: boolean }) => {
        const searchCategoriesForBackend = ["circles", "users", "projects"];
        if (!searchQuery.trim() && selectedGenres.length === 0) {
            // If clearing search via empty query, reset state
            setAllSearchResults([]);
            setDisplayedContent(
                filterCirclesByCategory(allDiscoverableCircles, selectedCategories)
                    .map(mapItemToContent)
                    .filter((c): c is Content => c !== null),
            );
            setHasSearched(false);
            setTriggerSnapIndex(SNAP_INDEX_PEEK); // Reset drawer to peek
            setContentPreview(undefined); // Clear preview

            // Close global left search panel
            setSidePanelMode("none");
            setSearchPanelState({
                query: "",
                isSearching: false,
                hasSearched: false,
                selectedCategories: [],
                selectedDateLabel: null,
                items: [],
                counts: { communities: 0, projects: 0, users: 0, events: filteredEventsForMap.length },
            });
            return;
        }

        // A pill already active from browsing shouldn't silently pre-scope a *new* text search —
        // reset it only on the transition into search (not on a refinement of an already-active
        // search, e.g. a genre pill change), so pills still work as a post-search narrowing tool
        // rather than getting reset out from under a search the user is already looking at. That
        // "refinement" intent didn't actually hold for the very first genre pill tapped before any
        // text search had ever run — isFreshSearch was true then too, silently wiping the active
        // tab back to "All" and un-scoping Genre/Physical/Calendar right when a user picks a genre
        // while browsing Artists/Venues/Events. preserveActiveCategory (passed only by the genre-
        // pill debounce below, never by an actual text-query trigger) is the fix: it keeps this
        // reset doing exactly what the comment above already says it should.
        const isFreshSearch = !hasSearched && !options?.preserveActiveCategory;
        if (isFreshSearch && selectedCategories.length > 0) {
            setSelectedCategories([]);
        }
        const effectiveCategories = isFreshSearch ? [] : selectedCategories;

        // Open global left search panel in searching state (desktop UX)
        setSidePanelMode("search");
        setSearchPanelState({
            query: searchQuery,
            isSearching: true,
            hasSearched: false,
            selectedCategories: effectiveCategories,
            selectedDateLabel: hasDateFilter ? dateLabel : null,
            items: [],
            counts: { communities: 0, projects: 0, users: 0, events: filteredEventsForMap.length },
        });
        if (!isMobile) {
            router.push("/explore?panel=search");
        }

        setIsSearching(true);
        setHasSearched(true);
        setAllSearchResults([]);
        setDisplayedContent([]);
        setContentPreview(undefined); // Clear preview on new search

        try {
            const results = await searchContentAction(
                searchQuery,
                searchCategoriesForBackend,
                selectedGenres.length > 0 ? selectedGenres : undefined,
            );
            setAllSearchResults(results);

            // Compute filtered list and counts for left panel now. Mirrors searchDisplayItems'
            // rule (circle types via filterCirclesByCategory, events included whenever selected
            // or nothing is) — using effectiveCategories/results directly (not the
            // searchDisplayItems memo) since those still reflect the previous render at this
            // point in the closure.
            const filtered = filterCirclesByCategory(results, effectiveCategories);
            const includesEvents = effectiveCategories.length === 0 || effectiveCategories.includes("events");
            const items = [...filtered, ...(includesEvents ? filteredEventsForMap : [])];
            const counts = { communities: 0, projects: 0, users: 0, events: filteredEventsForMap.length };
            results.forEach((r: any) => {
                if (isPeerifyVenueIdentity(r)) counts.communities++;
                else if (isPeerifyArtistIdentity(r)) counts.users++;
            });

            setSearchPanelState({
                query: searchQuery,
                isSearching: false,
                hasSearched: true,
                selectedCategories: effectiveCategories,
                selectedDateLabel: hasDateFilter ? dateLabel : null,
                items: items as any,
                counts,
            });
            setSidePanelMode("search");

            // Requirement 1: Jump to half-open state after search
            setTriggerSnapIndex(SNAP_INDEX_HALF);
        } catch (error) {
            console.error("Search action failed:", error);
            setAllSearchResults([]);

            // Reflect error state in left panel
            setSearchPanelState({
                query: searchQuery,
                isSearching: false,
                hasSearched: true,
                selectedCategories: effectiveCategories,
                selectedDateLabel: hasDateFilter ? dateLabel : null,
                items: [],
                counts: { communities: 0, projects: 0, users: 0, events: filteredEventsForMap.length },
            });

            setTriggerSnapIndex(SNAP_INDEX_PEEK); // Reset drawer on error
        } finally {
            setIsSearching(false);
        }
    }, [
        searchQuery,
        selectedGenres,
        setDisplayedContent,
        allDiscoverableCircles,
        selectedCategories,
        hasSearched,
        filterCirclesByCategory,
        setContentPreview,
        hasDateFilter,
        dateLabel,
        filteredEventsForMap,
        isMobile,
        router,
        setSearchPanelState,
        setSidePanelMode,
    ]);

    // Genre pills apply live (debounced) instead of waiting for Enter — the free-text
    // box below stays Enter-gated.
    const debouncedGenreSearch = useDebounce(handleSearchTrigger, 300);
    useEffect(() => {
        if (!genrePillChangedRef.current) return;
        genrePillChangedRef.current = false;
        debouncedGenreSearch({ preserveActiveCategory: true });
    }, [selectedGenres, debouncedGenreSearch]);

    const handleClearSearch = useCallback(() => {
        setSearchQuery("");
        setAllSearchResults([]);
        setHasSearched(false);
        setSelectedCategories([]);
        setDateRange(undefined);
        setSelectedGenres([]);
        setShowAdvancedFilters(false);
        setOpenAdvancedSection("");
        const resetMapData = filterCirclesByCategory(allDiscoverableCircles, [])
            .map((circle) => mapItemToContent(circle))
            .filter((c): c is Content => c !== null);
        setDisplayedContent(resetMapData);
        setTriggerSnapIndex(SNAP_INDEX_PEEK); // Reset drawer to peek
        setContentPreview(undefined); // Clear preview

        // Also reset/close the desktop left search panel so the map search box reappears
        setSidePanelMode("none");
        setSearchPanelState({
            query: "",
            isSearching: false,
            hasSearched: false,
            selectedCategories: [],
            selectedDateLabel: null,
            items: [],
            counts: { communities: 0, projects: 0, users: 0, events: filteredEventsForMap.length },
        });

        console.log("Search cleared, resetting map to all discoverable circles:", resetMapData.length);
    }, [
        setDisplayedContent,
        allDiscoverableCircles,
        filterCirclesByCategory,
        setContentPreview, // Add dependency
        filteredEventsForMap.length,
        setSearchPanelState,
        setSidePanelMode,
        setDateRange,
        setSelectedGenres,
    ]);

    const handleTriggerConsumed = useCallback(() => {
        console.log("Drawer consumed trigger, resetting triggerSnapIndex to -1");
        setTriggerSnapIndex(-1);
    }, []);

    const handleExplore = () => {
        setViewMode("explore");
    };
    const goToFeed = () => router.push("/foryou");
    const handleGotIt = async () => {
        // ... (no changes) ...
        setShowSwipeInstructions(false);
        if (user) {
            await completeSwipeOnboardingAction();
            setUser((prevUser) => ({
                ...prevUser!,
                completedOnboardingSteps: [...(prevUser!.completedOnboardingSteps || []), "swipe"],
            }));
        }
    };

    // --- Effects ---
    const getEventId = useCallback((evt: EventDisplay) => {
        return ((evt as any)._id?.toString?.() || (evt as any)._id || "") as string;
    }, []);

    useEffect(() => setIsMounted(true), []);

    useEffect(() => {
        const focusEventParam = searchParams.get("focusEvent");
        setPendingFocusEventId(focusEventParam);
        setHasAppliedFocusEvent(false);
    }, [searchParams]);

    // Keep map category in sync with URL (?category=events)
    useEffect(() => {
        if (viewMode !== "explore") return;
        const cat = searchParams.get("category");
        if (cat === "events") {
            setSelectedCategories(["events"]);
        }
    }, [searchParams, viewMode]);

    // When mobile drawer shows events, ensure events category is active on map
    useEffect(() => {
        if (drawerContent === "events") {
            setSelectedCategories(["events"]);
        }
    }, [drawerContent]);

    // Listen for map search commands from the left search panel (desktop)
    useEffect(() => {
        if (!mapSearchCommand) return;
        if (mapSearchCommand.timestamp === lastSearchCmdTs) return;
        setLastSearchCmdTs(mapSearchCommand.timestamp);
        const q = mapSearchCommand.query ?? "";
        if (!q.trim()) {
            handleClearSearch();
        } else {
            setSearchQuery(q);
            // Defer to let state commit before triggering search
            setTimeout(() => {
                handleSearchTrigger();
            }, 0);
        }
    }, [mapSearchCommand, lastSearchCmdTs, handleClearSearch, handleSearchTrigger]);

    // Fetch events for map when date range changes
    useEffect(() => {
        let canceled = false;
        const load = async () => {
            setIsEventsLoading(true);
            try {
                const range =
                    dateRange && (dateRange.from || dateRange.to)
                        ? {
                              from: dateRange.from ? dateRange.from.toISOString() : undefined,
                              to: dateRange.to ? dateRange.to.toISOString() : undefined,
                          }
                        : undefined;
                const data = await getOpenEventsForMapAction(
                    range as any,
                    selectedGenres.length > 0 ? selectedGenres : undefined,
                );
                if (!canceled) {
                    // No location.lngLat filter here — getOpenEventsForMapAction already only
                    // returns events with a geocoded point or virtual ones, and MapDisplay itself
                    // skips placing a marker for anything without location.lngLat (map.tsx), so a
                    // virtual event with no location still needs to reach eventsForMap for the
                    // events-category count/list, it just never gets a pin.
                    setEventsForMap(data || []);
                }
            } catch (e) {
                console.error("Failed to load events for map:", e);
                if (!canceled) setEventsForMap([]);
            } finally {
                if (!canceled) setIsEventsLoading(false);
            }
        };
        load();
        return () => {
            canceled = true;
        };
    }, [dateRange?.from, dateRange?.to, selectedGenres]);

    // Fetch Offer pins once — no date/genre filters of its own, unlike events above. Stored raw,
    // unfiltered/unjittered/ungrouped: jitterSameCoordinateOfferPins and groupIdentityOfferPins
    // both need to run AFTER selectedOfferTypes filtering (see the offerMapData derivation below),
    // not here — otherwise a venue's marker badge/an anonymous cluster's jitter would reflect the
    // full unfiltered offering set instead of what's actually visible under the active filter.
    useEffect(() => {
        let canceled = false;
        (async () => {
            const data = await getOfferMapPinsAction();
            if (!canceled) setOfferMapPins(data || []);
        })();
        return () => {
            canceled = true;
        };
    }, []);

    useEffect(() => {
        if (!pendingFocusEventId || hasAppliedFocusEvent) return;
        const targetEvent = eventsForMap.find((evt) => getEventId(evt) === pendingFocusEventId);
        if (!targetEvent) return;

        setSelectedCategories(["events"]);
        setZoomContent(targetEvent);
        setDisplayedContent((filteredEventsForMap.length ? filteredEventsForMap : [targetEvent]) as unknown as Content[]);
        setContentPreview({
            type: "event",
            content: targetEvent,
            props: { circleHandle: targetEvent.circle?.handle || "" },
        });
        if (isMobile) {
            setDrawerContent("events");
            setTriggerSnapIndex((prev) => (prev < SNAP_INDEX_HALF ? SNAP_INDEX_HALF : prev));
        } else {
            setSidePanelMode("events");
        }

        setHasAppliedFocusEvent(true);

        if (searchParams.get("focusEvent")) {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("focusEvent");
            const next = params.toString();
            router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
        }
    }, [
        pendingFocusEventId,
        hasAppliedFocusEvent,
        eventsForMap,
        getEventId,
        isMobile,
        setDrawerContent,
        setZoomContent,
        setContentPreview,
        setSidePanelMode,
        setSelectedCategories,
        setDisplayedContent,
        filteredEventsForMap,
        router,
        pathname,
        searchParams,
        setTriggerSnapIndex,
    ]);

    // Reset index when swipe circles change
    useEffect(() => setCurrentIndex(0), [displayedSwipeCircles]);

    // Update map zoom for the current swipe card
    useEffect(() => {
        // ... (no changes) ...
        if (viewMode === "cards" && currentIndex < displayedSwipeCircles.length) {
            const currentCircle = displayedSwipeCircles[currentIndex];
            if (currentCircle?.location?.lngLat) {
                setTimeout(() => handleSetZoomContent(currentCircle), 100);
            }
        }
    }, [currentIndex, displayedSwipeCircles, viewMode, handleSetZoomContent]);

    // Update map markers when in Explore mode
    useEffect(() => {
        if (viewMode === "explore") {
            // Side panel "events" mode (desktop left-nav Events panel) is an independent override —
            // show only event markers regardless of selectedCategories.
            if (panelMode === "events") {
                setDisplayedContent(filteredEventsForMap as unknown as Content[]);
                return;
            }
            let circles = baseCircles;
            if (dateRange?.from || dateRange?.to) {
                circles = circles.filter((c) => withinDateRange((c as any).createdAt));
            }
            const mapData: Content[] = circles
                .map((circle) => mapItemToContent(circle))
                .filter((c): c is Content => c !== null);

            // baseCircles is already correctly scoped to whichever circle types are selected (or
            // every type, if none are) via filterCirclesByCategory — only events need handling
            // here explicitly, since they're a separate dataset filterCirclesByCategory never
            // touches. "All" (empty array) always includes events, same as today.
            const includesEvents = selectedCategories.length === 0 || selectedCategories.includes("events");
            // offerMapPins is likewise a separate dataset (see its fetch effect) —
            // filterCirclesByCategory never touches it either, same "All" always-includes rule.
            // Not routed through mapItemToContent — that helper expects circle-shaped data
            // (checks for circleType/type), and OfferMapPin has neither; it's already Content-
            // shaped enough to cast directly, same as events below. includesOffers is the shared
            // memo declared near selectedCategories, also used by the Offer-type filter UI.
            // Applied on top of includesOffers, not instead of it — an empty selectedOfferTypes
            // means "all types", same "All" convention as selectedCategories/selectedGenres.
            const offerPinsForCategory = includesOffers ? offerMapPins : [];
            const typeFilteredOfferPins =
                selectedOfferTypes.length === 0
                    ? offerPinsForCategory
                    : offerPinsForCategory.filter((pin) => selectedOfferTypes.includes(pin.offerType));
            // Grouping and jitter both run here, on the already-filtered set — see the fetch
            // effect's own comment for why neither can run once at fetch time.
            const offerMapData: Content[] = jitterSameCoordinateOfferPins(
                groupIdentityOfferPins(typeFilteredOfferPins),
            ) as unknown as Content[];
            const combined: Content[] = [
                ...mapData,
                ...(includesEvents ? (filteredEventsForMap as unknown as Content[]) : []),
                ...offerMapData,
            ];
            setDisplayedContent(combined);
        }
    }, [
        viewMode,
        baseCircles,
        dateRange,
        withinDateRange,
        setDisplayedContent,
        selectedCategories,
        filteredEventsForMap,
        offerMapPins,
        selectedOfferTypes,
        includesOffers,
        panelMode, // Added dependency
    ]);

    // Control drawer snap based on contentPreview state
    useEffect(() => {
        if (isMobile && viewMode === "explore") {
            if (drawerContent === "noticeboard" || drawerContent === "events") {
                setTriggerSnapIndex(SNAP_INDEX_HALF);
            } else if (contentPreview) {
                setDrawerContent("preview");
                // Requirement 4: Expand drawer when preview is shown
                setTriggerSnapIndex(SNAP_INDEX_OPEN);
            } else {
                // When preview is closed, return to half if search active, else peek
                setTriggerSnapIndex(hasSearched ? SNAP_INDEX_HALF : SNAP_INDEX_PEEK);
            }
        }
        // Add dependencies that should trigger this logic
    }, [contentPreview, isMobile, viewMode, hasSearched, drawerContent, setDrawerContent]);

    // Reset drawer and preview when switching view modes or leaving mobile explore
    useEffect(() => {
        if (!isMobile || viewMode !== "explore") {
            setTriggerSnapIndex(SNAP_INDEX_PEEK); // Reset to base state
            setContentPreview(undefined); // Clear preview if leaving explore mode
        }
    }, [isMobile, viewMode, setContentPreview]);

    // Initial focus/map update logic (remains the same)
    useEffect(() => {
        // ... (no changes) ...
        if (viewMode === "cards" && displayedSwipeCircles.length > 0 && currentIndex === 0) {
            const firstCircle = displayedSwipeCircles[0];
            setDisplayedContent([firstCircle].filter(Boolean));
            if (firstCircle?.location?.lngLat) {
                setTimeout(() => handleSetZoomContent(firstCircle), 300);
            }
        }
    }, [displayedSwipeCircles, viewMode, handleSetZoomContent, setDisplayedContent, currentIndex]);

    // Onboarding instructions logic (remains the same)
    useEffect(() => {
        // ... (no changes) ...
        if (
            viewMode === "cards" &&
            user &&
            displayedSwipeCircles.length > 0 &&
            (!user.completedOnboardingSteps || !user.completedOnboardingSteps.includes("swipe"))
        ) {
            setShowSwipeInstructions(true);
        } else {
            setShowSwipeInstructions(false);
        }
    }, [user, displayedSwipeCircles, viewMode]);

    if (!isMounted) return null;

    // Measured live on staging (375/390/430px): nothing residual (no safe-area-inset,
    // no leftover container padding) sits between this and the true viewport edge —
    // the entire gap was just this constant. 6px is the minimal intentional margin
    // kept so the bar/pills don't sit flush against the edge.
    const mobileTopControlsLeft = 6;
    // Logged in, the avatar now renders inside the search bar itself (see the
    // slot div at the bar's trailing end below) rather than floating in a fixed
    // top-right slot, so there's nothing left to reserve space for — mirror the
    // left inset. Logged out, the profile-menu's "Log in"/"Sign up" buttons still
    // float in their fixed top-right slot (unchanged), so keep reserving space for
    // that pair: measured overlap on staging confirmed it needs ~193px (169px wide
    // + the 24px right-6 offset) — bumped with a small buffer.
    const mobileTopControlsRight = user ? mobileTopControlsLeft : 205;

    // Mobile drawer's circle row — unchanged from before the Category multi-select work, just
    // extracted so it can be reused across the Artists/Venues/Other sections below instead of
    // one flat list.
    const renderDrawerCircleItem = (item: WithMetric<Circle>) => (
        <li
            key={item._id}
            className="flex cursor-pointer items-center gap-2 rounded pb-2 pt-1 hover:bg-gray-100"
            onClick={() => {
                // drawerListData is hasSearched ? filteredSearchResults (searchable-gated)
                // : allDiscoverableCircles (mapVisible-gated) — tag source accordingly.
                const previewData: ContentPreviewData = {
                    type: (item.circleType || "circle") as any,
                    content: item as any,
                    props: { source: hasSearched ? "search" : "map" },
                } as any;
                setContentPreview(previewData);
                if (item.location?.lngLat) {
                    handleSetZoomContent(item);
                }
            }}
            title={item.location?.lngLat ? "Click to focus map and view details" : "Click to view details"}
        >
            <div className="relative">
                <CirclePicture circle={item} size="60px" showTypeIndicator={true} />
            </div>
            <div className="relative flex-1 overflow-hidden pl-4">
                <div className="truncate p-0 text-xl font-medium">{item.name || "Untitled"}</div>
                <div className="text-md mt-1 line-clamp-2 p-0 text-gray-500">
                    {item.description || item.mission || ""}
                </div>
                {item.metrics && (
                    <div className="flex flex-row pt-1">
                        <Indicators className="pointer-events-none" metrics={item.metrics} />
                        <div className="flex-1" />
                    </div>
                )}
            </div>
            <div className="relative">
                <HiChevronRight className="h-4 w-4" />
            </div>
        </li>
    );

    // New: events previously never appeared in this drawer at all (only via the separate
    // MobileEventsPanel, reached through the bottom nav — see drawerContent === "events" above).
    // Matches the circle row's footprint/click behavior; the "picture" slot is a calendar icon
    // instead of CirclePicture since an event isn't a circle and has no picture field.
    const renderDrawerEventItem = (event: EventDisplay) => (
        <li
            key={(event as any)._id}
            className="flex cursor-pointer items-center gap-2 rounded pb-2 pt-1 hover:bg-gray-100"
            onClick={() => {
                const previewData: ContentPreviewData = {
                    type: "event",
                    content: event as any,
                    props: { circleHandle: event.circle?.handle || "" },
                } as any;
                setContentPreview(previewData);
                if ((event as any).location?.lngLat) {
                    handleSetZoomContent(event as any);
                }
            }}
            title="Click to view details"
        >
            <div className="relative flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full bg-gray-100">
                <CalendarIcon className="h-6 w-6 text-gray-500" />
            </div>
            <div className="relative flex-1 overflow-hidden pl-4">
                <div className="truncate p-0 text-xl font-medium">{event.title || "Untitled"}</div>
                <div className="text-md mt-1 line-clamp-2 p-0 text-gray-500">
                    {format(new Date(event.startAt), "PPp")}
                    {event.endAt ? ` — ${format(new Date(event.endAt), "PPp")}` : ""}
                </div>
            </div>
            <div className="relative">
                <HiChevronRight className="h-4 w-4" />
            </div>
        </li>
    );

    // Section order mirrors the top Artists/Venues/Events pills, same convention as
    // search-results-panel.tsx's desktop grouping.
    const drawerSectionList: { key: string; label: string; items: any[]; renderItem: (item: any) => React.ReactNode }[] = [
        { key: "artists", label: "Artists", items: drawerSections.artists, renderItem: renderDrawerCircleItem },
        { key: "venues", label: "Venues", items: drawerSections.venues, renderItem: renderDrawerCircleItem },
        { key: "events", label: "Events", items: drawerSections.events, renderItem: renderDrawerEventItem },
        { key: "other", label: "Other", items: drawerSections.other, renderItem: renderDrawerCircleItem },
    ];

    // --- Render ---
    return (
        <div className="relative flex w-full flex-row overflow-hidden md:h-full">
            {/* Map container */}
            {mapboxKey && (
                <div className="relative flex-1">
                    <MapDisplay mapboxKey={mapboxKey} />
                </div>
            )}

            {/* Top Bar Controls */}
            <div
                className={`absolute ${isMobile ? "flex-col" : "flex-row"} z-[30] flex gap-2`} // allow profile icons to sit above
                style={{
                    left: isMobile ? mobileTopControlsLeft : panelMode !== "none" ? 440 : 16,
                    right: isMobile ? mobileTopControlsRight : 280, // Reserve space on mobile for avatar/action buttons.
                    top: isMobile ? 12 : 16,
                }}
            >
                {/* View Mode Toggle removed: Explore mode only */}

                {/* Search Bar & Filters (Only in Explore Mode) */}
                {viewMode === "explore" && !(sidePanelContentVisible === "toolbox" && isMobile) && (
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex w-full flex-col gap-2 md:flex-row md:items-center md:gap-4">
                            <div className="flex w-full md:w-[23.5rem] md:max-w-[23.5rem] md:flex-none items-center rounded-full bg-white/95 p-1 pl-4 shadow-md ring-1 ring-black/5 backdrop-blur-sm">
                                <input
                                    type="text"
                                    placeholder="Search artists, venues, and events"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleSearchTrigger()}
                                    onFocus={() => setMobileExploreSearchFocused(true)}
                                    onBlur={() => setMobileExploreSearchFocused(false)}
                                    className="min-w-0 flex-1 border-none bg-transparent pl-1 text-base outline-none focus:ring-0"
                                />
                                <SearchFilters
                                    value={filtersValue}
                                    onChange={handleFiltersChange}
                                    open={showAdvancedFilters}
                                    onOpenChange={setShowAdvancedFilters}
                                    openSection={openAdvancedSection}
                                    onOpenSectionChange={setOpenAdvancedSection}
                                    isMobile={isMobile}
                                />
                                {searchQuery || activeAdvancedFilterCount > 0 ? (
                                    <Button
                                        onClick={handleClearSearch}
                                        size="sm"
                                        variant="ghost"
                                        className="ml-1 h-9 w-9 rounded-full p-0"
                                        aria-label="Clear search"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                ) : null}
                                <Button
                                    onClick={() => handleSearchTrigger()}
                                    size="sm"
                                    variant="ghost"
                                    className="ml-1 h-9 w-9 rounded-full p-0"
                                    disabled={isSearching || (!searchQuery.trim() && selectedGenres.length === 0)}
                                    aria-label="Search"
                                >
                                    {isSearching ? "..." : <Search className="h-4 w-4" />}
                                </Button>

                                {/* Mobile-only portal target: profile-menu.tsx renders its
                                    isMobileExplore avatar/fan-out here instead of its usual
                                    fixed top-right slot — see mobileExploreAvatarSlotAtom. */}
                                {isMobile && user && (
                                    <div ref={mobileExploreAvatarSlotRef} className="flex shrink-0 items-center" />
                                )}
                            </div>

                            <CategoryFilterCarousel
                                className="min-w-0 md:w-auto md:max-w-[calc(100%-24.5rem)] md:flex-none"
                                categories={RESULT_TYPE_OPTIONS.map((option) => option.value)}
                                categoryCounts={{
                                    communities: categoryCounts.communities,
                                    events: categoryCounts.events,
                                    users: categoryCounts.users,
                                    offers: categoryCounts.offers,
                                }}
                                selectedCategories={selectedCategories}
                                onSelectionChange={setSelectedCategories}
                                hasSearched={true}
                                displayLabelMap={{
                                    users: "Artists",
                                    communities: "Venues",
                                    events: "Events",
                                    offers: "Offers",
                                }}
                            />
                        </div>

                        <GenreFilterChips
                            selectedGenres={selectedGenres}
                            onRemove={(genre) =>
                                handleFiltersChange({
                                    ...filtersValue,
                                    selectedGenres: filtersValue.selectedGenres.filter((g) => g !== genre),
                                })
                            }
                        />
                        {includesOffers && (
                            <OfferTypeFilterChips
                                selectedOfferTypes={selectedOfferTypes}
                                onRemove={(offerType) =>
                                    handleFiltersChange({
                                        ...filtersValue,
                                        selectedOfferTypes: filtersValue.selectedOfferTypes.filter((t) => t !== offerType),
                                    })
                                }
                            />
                        )}
                    </div>
                )}
            </div>

            {/* Cards View */}
            {viewMode === "cards" && (
                <div
                    className={cn(
                        `absolute z-40 flex flex-col items-center justify-start overflow-visible transition-opacity duration-300`,
                        isMobile ? "w-full" : "w-[400px]",
                    )}
                    style={{
                        top: isMobile ? "80px" : "110px",
                        height: `calc(${windowHeight}px - 150px)`,
                    }}
                >
                    <div className="relative mb-4 flex w-full max-w-[400px] flex-col items-center">
                        {displayedSwipeCircles.length > 0 ? (
                            <div className="relative flex h-[500px] w-full max-w-[400px] items-center justify-center">
                                {currentIndex < displayedSwipeCircles.length && (
                                    <>
                                        <CircleSwipeCard
                                            key={displayedSwipeCircles[currentIndex]._id}
                                            circle={displayedSwipeCircles[currentIndex]}
                                            onSwiped={handleSwiped}
                                            zIndex={30}
                                        />
                                        {displayedSwipeCircles
                                            .slice(currentIndex + 1, currentIndex + 5)
                                            .map((circle, index) => (
                                                <div
                                                    key={circle._id}
                                                    className="absolute h-[450px] max-w-[400px] overflow-hidden rounded-xl border bg-white shadow-lg md:h-[560px]"
                                                    style={{
                                                        zIndex: 29 - index,
                                                        transform: `translateX(${
                                                            (index + 1) * 3
                                                        }px) translateY(${(index + 1) * -2}px)`,
                                                        opacity: 0.9,
                                                        pointerEvents: "none",
                                                        width: "calc(100% - 2rem)",
                                                    }}
                                                >
                                                    <div className="relative h-[220px] w-full overflow-hidden md:h-[300px]">
                                                        <Image
                                                            src={
                                                                circle.images?.[0]?.fileInfo?.url ??
                                                                "/images/default-cover.png"
                                                            }
                                                            alt=""
                                                            className="pointer-events-none object-cover"
                                                            fill
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                    </>
                                )}
                                {(currentIndex >= displayedSwipeCircles.length ||
                                    displayedSwipeCircles.length === 0) && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="flex max-w-[400px] flex-col items-center gap-4 rounded-xl border bg-white p-8 shadow-lg"
                                    >
                                        <div className="text-xl font-semibold">You&apos;ve seen all circles!</div>
                                        <p className="text-center text-gray-600">
                                            Check back later for more recommendations
                                        </p>
                                        <div className="flex flex-row gap-2">
                                            <Button onClick={handleExplore} className="mt-4 gap-2">
                                                <MdOutlineTravelExplore className="h-4 w-4" /> Explore
                                            </Button>
                                            <Button onClick={goToFeed} className="mt-4 gap-2">
                                                <Home className="h-4 w-4" /> Go to Noticeboard
                                            </Button>
                                        </div>
                                    </motion.div>
                                )}
                            </div>
                        ) : (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="ml-2 flex max-w-[400px] flex-col items-center gap-4 rounded-xl border bg-white p-8 shadow-lg"
                            >
                                <div className="text-xl font-semibold">No circles to show!</div>
                                <p className="text-center text-gray-600">
                                    You might have seen, followed, or ignored all available circles.
                                </p>
                                <div className="flex flex-row gap-2">
                                    <Button onClick={handleExplore} className="mt-4 gap-2">
                                        <MdOutlineTravelExplore className="h-4 w-4" /> Explore
                                    </Button>
                                    <Button onClick={goToFeed} className="mt-4 gap-2">
                                        <Home className="h-4 w-4" /> Go to Noticeboard
                                    </Button>
                                </div>
                            </motion.div>
                        )}
                    </div>
                </div>
            )}

            {/* Desktop Search Results Panel moved to global left panel */}
            {false && viewMode === "explore" && hasSearched && !isMobile && (
                <div className="formatted absolute left-4 top-[120px] z-40 max-h-[calc(100vh-130px)] w-[300px] overflow-y-auto rounded-lg bg-white shadow-lg">
                    <div className="p-4">
                        <h3 className="mb-2 font-semibold">Search Results</h3>
                        {isSearching && <p>Loading...</p>}
                        {!isSearching &&
                            allSearchResults.length > 0 &&
                            filteredSearchResults.length === 0 &&
                            selectedCategories.length > 0 && (
                                <p className="text-sm text-gray-500">
                                    No results found for category &quot;{selectedCategories.join(", ")}&quot;.
                                </p>
                            )}
                        {!isSearching && allSearchResults.length === 0 && hasSearched && (
                            <p className="text-sm text-gray-500">No results found for &quot;{searchQuery}&quot;.</p>
                        )}
                    </div>
                    {!isSearching && displayedContent.length > 0 && (
                        <ul className="space-y-2">
                            {/* Filter displayedContent to only include CircleLike items before mapping */}
                            {displayedContent
                                .filter(
                                    (item): item is Circle | MemberDisplay =>
                                        "circleType" in (item as any) &&
                                        ((item as any).circleType === "user" ||
                                            (item as any).circleType === "circle" ||
                                            (item as any).circleType === "project"),
                                )
                                .map((item) => (
                                    <li
                                        key={item._id} // Use MongoDB _id
                                        className="flex cursor-pointer items-center gap-2 rounded pb-2 pl-3 pt-1 hover:bg-gray-100"
                                        onClick={(e) => {
                                            // Zoom map
                                            if (item.location?.lngLat) {
                                                // Cast item to any for handleSetZoomContent call site
                                                handleSetZoomContent(item as any);
                                            }
                                            // Open preview or navigate
                                            if (isMobile) {
                                                return; // no preview
                                            } else {
                                                // Open preview panel
                                                // Cast content to any to resolve userGroups mismatch from MemberDisplay
                                                const contentPreviewData: ContentPreviewData = {
                                                    type: (item.circleType || "circle") as any, // Cast type as well for safety
                                                    content: item as any,
                                                };
                                                setContentPreview((prev) =>
                                                    prev?.content?._id === item._id ? undefined : contentPreviewData,
                                                );
                                                e.stopPropagation(); // Prevent potential map click through
                                            }
                                        }}
                                        title={
                                            item.location?.lngLat
                                                ? "Click to focus map and view details"
                                                : "Click to view details (no location)"
                                        }
                                    >
                                        <div className="relative">
                                            {/* Pass item directly, CirclePicture now accepts CircleLike */}
                                            <CirclePicture circle={item} size="40px" showTypeIndicator={true} />
                                        </div>
                                        <div className="relative flex-1 overflow-hidden pl-2">
                                            <div className="truncate p-0 text-sm font-medium">
                                                {/* Handle name based on type */}
                                                {"name" in item && item.name ? item.name : "Post"}
                                            </div>
                                            <div className="mt-1 line-clamp-2 p-0 text-xs text-gray-500">
                                                {/* Handle description/content/mission based on type */}
                                                {"description" in item
                                                    ? (item.description ??
                                                      ("mission" in item ? item.mission : "") ??
                                                      "")
                                                    : "content" in item && typeof item.content === "string"
                                                      ? item.content.substring(0, 70) +
                                                        (item.content.length > 70 ? "..." : "")
                                                      : ""}
                                            </div>
                                            {/* Ensure metrics check is robust */}
                                            {"metrics" in item && item.metrics && (
                                                <div className="flex flex-row pt-1">
                                                    <Indicators
                                                        className="pointer-events-none"
                                                        metrics={item.metrics}
                                                    />
                                                    <div className="flex-1" />
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                ))}
                        </ul>
                    )}
                </div>
            )}

            {/* Mobile Explore Drawer */}
            {viewMode === "explore" && isMobile && windowHeight > 0 && (
                <ResizingDrawer
                    snapPoints={snapPoints}
                    initialSnapPointIndex={SNAP_INDEX_PEEK} // Start at peek
                    triggerSnapIndex={triggerSnapIndex}
                    onTriggerConsumed={handleTriggerConsumed}
                    moveThreshold={60} // Adjust as needed
                    overlayHandle={drawerContent === "preview"} // Float the drag handle over the preview's hero image instead of a separate bar
                    onSnapChange={(index) => {
                        // Any downward swipe while previewing dismisses it, same as the close
                        // button — not just one that happens to land exactly on the lowest snap
                        // index, since a single swipe only moves one snap level at a time.
                        const previousIndex = prevSnapIndexRef.current;
                        prevSnapIndexRef.current = index;
                        if (index < previousIndex && drawerContent === "preview") {
                            setContentPreview(undefined);
                            setDrawerContent("explore");
                        }
                    }}
                >
                    {drawerContent === "preview" ? (
                        // --- Content Preview View ---
                        // No separate header bar: the close button floats over the hero
                        // image (same treatment as the drag handle) so the image starts
                        // immediately below the map.
                        <div className="relative flex h-full flex-col">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    setContentPreview(undefined);
                                    setDrawerContent("explore");
                                }}
                                aria-label="Close preview"
                                className="absolute right-3 top-3 z-40 h-8 w-8 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                            <div className="flex-1 overflow-y-auto">
                                <ContentPreview />
                            </div>
                        </div>
                    ) : drawerContent === "noticeboard" ? (
                        // --- Noticeboard View ---
                        <div className="flex h-full flex-col">
                            <div className="flex-1 overflow-y-auto">
                                <ActivityPanel />
                            </div>
                        </div>
                    ) : drawerContent === "events" ? (
                        // --- Events View (Mobile) ---
                        <div className="flex h-full flex-col">
                            <div className="flex-1 overflow-y-auto">
                                <MobileEventsPanel />
                            </div>
                        </div>
                    ) : (
                        // --- List View (Default / Search Results) ---
                        <div className="flex-1 rounded-t-[10px] bg-white pt-0">
                            <div className="mx-0 px-4 pb-4">
                                {isSearching && <p className="py-4 text-center">Loading...</p>}
                                {!isSearching && !drawerHasResults && (
                                    <div className="py-6 text-center">
                                        <p className="text-sm font-medium text-gray-900">{searchEmptyState.title}</p>
                                        <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">
                                            {searchEmptyState.description}
                                        </p>
                                    </div>
                                )}
                                {!isSearching && drawerHasResults && (
                                    <div>
                                        {drawerSectionList.map(({ key, label, items, renderItem }) => {
                                            if (items.length === 0) return null;
                                            return (
                                                <div key={key}>
                                                    <div className="px-1 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500 first:pt-0">
                                                        {label} · {items.length}
                                                    </div>
                                                    <ul className="space-y-2">{items.map((item) => renderItem(item))}</ul>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </ResizingDrawer>
            )}

            {/* Swipe instructions popup */}
            {showSwipeInstructions && viewMode === "cards" && (
                // ... (no changes needed here) ...
                <motion.div
                    className="absolute bottom-0 left-0 right-0 top-0 z-[60] flex items-center justify-center bg-black/50" // Increased z-index
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                >
                    <div className="max-w-[350px] rounded-lg bg-white p-6 text-center shadow-xl">
                        <h3 className="mb-3 text-xl font-semibold">How to Discover</h3>
                        {/* Hand animation */}
                        <div className="relative mb-6 h-20 w-full">
                            <motion.div
                                className="absolute flex h-full w-full items-center justify-center"
                                animate={{ x: [0, -40, 0, 40, 0] }}
                                transition={{ repeat: Infinity, duration: 4, times: [0, 0.25, 0.5, 0.75, 1] }}
                            >
                                <Hand className="h-16 w-16 text-gray-600" />
                            </motion.div>
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-red-500">
                                Ignore
                            </div>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-green-500">
                                Follow
                            </div>
                        </div>
                        <p className="mb-6 text-gray-600">Swipe card right to follow, left to ignore.</p>
                        <Button onClick={handleGotIt} className="w-full">
                            Got it
                        </Button>
                    </div>
                </motion.div>
            )}
        </div>
    );
};

export default MapExplorer;
