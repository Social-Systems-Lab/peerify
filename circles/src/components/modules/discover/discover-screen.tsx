"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import Link from "next/link";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Search, X, SlidersHorizontal } from "lucide-react";
import { userAtom } from "@/lib/data/atoms";
import { useDebounce } from "@/components/utils/use-debounce";
import { useIsMobile } from "@/components/utils/use-is-mobile";
import { EventDisplay } from "@/models/models";
import {
    SearchFilters,
    SearchFiltersValue,
    CategoryFilterCarousel,
    GenreFilterChips,
} from "@/components/modules/search/search-filters";
import { getDiscoverResultsAction, DiscoverResults } from "./actions";
import ArtistCard from "./artist-card";

const DISCOVER_CATEGORIES = ["users", "events"] as const;
const DISCOVER_CATEGORY_LABELS: Record<string, string> = { users: "Artists", events: "Events" };

const DEFAULT_DISCOVER_FILTERS: SearchFiltersValue = {
    selectedCategories: [],
    selectedGenres: [],
    selectedOfferTypes: [],
    dateRange: undefined,
    physicalOnly: false,
    searchQuery: "",
};

const DISCOVER_FILTERS_STORAGE_VERSION = 1;

type PersistedDiscoverFilters = { version: number; value: SearchFiltersValue };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizeStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const sanitizeDateRange = (value: unknown): DateRange | undefined => {
    if (!isRecord(value)) return undefined;
    const from = typeof value.from === "string" ? new Date(value.from) : undefined;
    const to = typeof value.to === "string" ? new Date(value.to) : undefined;
    const validFrom = from && !isNaN(from.getTime()) ? from : undefined;
    const validTo = to && !isNaN(to.getTime()) ? to : undefined;
    if (!validFrom && !validTo) return undefined;
    return { from: validFrom, to: validTo };
};

// Mirrors sanitizePersistedTasksListViewState's pattern (tasks-list.tsx): a versioned envelope
// that's discarded wholesale on a version mismatch, rather than trying to migrate an old shape.
const sanitizePersistedDiscoverFilters = (value: unknown): SearchFiltersValue | null => {
    if (!isRecord(value) || value.version !== DISCOVER_FILTERS_STORAGE_VERSION || !isRecord(value.value)) {
        return null;
    }
    const raw = value.value;
    return {
        selectedCategories: sanitizeStringArray(raw.selectedCategories).filter((c) =>
            (DISCOVER_CATEGORIES as readonly string[]).includes(c),
        ),
        selectedGenres: sanitizeStringArray(raw.selectedGenres),
        // Offers aren't a category on this screen (see DISCOVER_CATEGORIES) — always empty.
        selectedOfferTypes: [],
        dateRange: sanitizeDateRange(raw.dateRange),
        physicalOnly: raw.physicalOnly === true,
        searchQuery: typeof raw.searchQuery === "string" ? raw.searchQuery : "",
    };
};

// Not getActiveSearchFilterCount (search-filters.tsx): that helper treats exactly one selected
// category as the "neutral" shape, matching Explore's own default of a single active pill
// (["users"]). Discover's neutral/untouched default is "All" (selectedCategories: []) instead, so
// reusing it here would count a completely-untouched filtersValue as "1 active filter" and both
// wrongly show the restored-filters banner and wrongly skip the initial-fetch optimization below.
const isDefaultDiscoverFilters = (value: SearchFiltersValue): boolean =>
    value.selectedCategories.length === 0 &&
    value.selectedGenres.length === 0 &&
    value.selectedOfferTypes.length === 0 &&
    !value.dateRange?.from &&
    !value.dateRange?.to &&
    !value.physicalOnly &&
    !value.searchQuery;

const describeFilters = (value: SearchFiltersValue): string => {
    const parts: string[] = [];
    if (value.selectedCategories.length === 1) {
        parts.push(DISCOVER_CATEGORY_LABELS[value.selectedCategories[0]] ?? value.selectedCategories[0]);
    }
    if (value.selectedGenres.length > 0) {
        parts.push(value.selectedGenres.join(", "));
    }
    if (value.dateRange?.from || value.dateRange?.to) {
        const from = value.dateRange.from ? format(value.dateRange.from, "MMM d") : "";
        const to = value.dateRange.to ? format(value.dateRange.to, "MMM d") : "now";
        parts.push(from ? `${from} – ${to}` : to);
    }
    if (value.physicalOnly) {
        parts.push("in-person only");
    }
    return parts.length > 0 ? parts.join(" · ") : "no filters";
};

const formatEventWhen = (event: EventDisplay): string => {
    if (!event.startAt) return "";
    const start = new Date(event.startAt);
    const sameYear = start.getFullYear() === new Date().getFullYear();
    return format(start, sameYear ? "EEE, MMM d · p" : "EEE, MMM d, yyyy");
};

type DiscoverScreenProps = {
    initialResults: DiscoverResults;
};

export default function DiscoverScreen({ initialResults }: DiscoverScreenProps) {
    const user = useAtomValue(userAtom);
    const isMobile = useIsMobile();
    const [filtersValue, setFiltersValue] = useState<SearchFiltersValue>(DEFAULT_DISCOVER_FILTERS);
    const [results, setResults] = useState<DiscoverResults>(initialResults);
    const [isLoading, setIsLoading] = useState(false);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [openAdvancedSection, setOpenAdvancedSection] = useState("");
    const [isMounted, setIsMounted] = useState(false);
    const [restoredFromStorage, setRestoredFromStorage] = useState(false);

    // Per-user (not the single global userSettingsAtom key): a genre/date/category preference is
    // personal in a way a feed-tab choice isn't, and this keeps SearchFiltersValue's richer shape
    // (a Date-bearing range, several arrays) out of the shared UserSettings model entirely — no
    // change to models.ts, no risk of colliding with unrelated userSettingsAtom consumers.
    const storageKey = useMemo(() => `discover-filters:${user?.did || "anonymous"}`, [user?.did]);

    // Restore-on-mount, gated the same way tasks-list.tsx's own persisted view state is: avoids a
    // hydration mismatch between the server-rendered default and a client-only localStorage read.
    useEffect(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const restored = sanitizePersistedDiscoverFilters(JSON.parse(raw));
                if (restored) {
                    setFiltersValue(restored);
                    if (!isDefaultDiscoverFilters(restored)) {
                        setRestoredFromStorage(true);
                    }
                }
            }
        } catch {
            // Ignore unreadable persisted state and fall back to defaults.
        }
        setIsMounted(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageKey]);

    // Save-on-change, same isMounted gate as the restore effect above so this never immediately
    // overwrites a not-yet-applied restore with the pre-hydration default.
    useEffect(() => {
        if (!isMounted) return;
        try {
            const toSave: PersistedDiscoverFilters = { version: DISCOVER_FILTERS_STORAGE_VERSION, value: filtersValue };
            localStorage.setItem(storageKey, JSON.stringify(toSave));
        } catch {
            // Ignore storage write failures and keep the current in-memory state.
        }
    }, [isMounted, storageKey, filtersValue]);

    // SearchFilters always spreads unchanged fields through from the value it's given (see its
    // own onChange contract) — setFiltersValue(next) here preserves that reference equality as-is,
    // and every other place on this screen that builds a "next" value below does the same (spreads
    // filtersValue, only replaces the one field being changed) rather than reconstructing the
    // object, so a future consumer of this screen's state can rely on the same contract MapExplorer
    // does.
    const handleFiltersChange = useCallback((next: SearchFiltersValue) => {
        setRestoredFromStorage(false);
        setFiltersValue(next);
    }, []);

    const fetchResults = useCallback(async (value: SearchFiltersValue) => {
        setIsLoading(true);
        try {
            const data = await getDiscoverResultsAction({
                query: value.searchQuery,
                selectedCategories: value.selectedCategories,
                primaryGenres: value.selectedGenres,
                dateRange: value.dateRange
                    ? { from: value.dateRange.from?.toISOString(), to: value.dateRange.to?.toISOString() }
                    : undefined,
            });
            setResults(data);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const debouncedFetch = useDebounce(fetchResults, 350);

    // Skips the very first post-mount fetch when nothing was restored from storage — the server
    // component already fetched the true-default result set for the first paint, so refetching
    // the identical query would just be wasted latency. Any restored (non-default) filters still
    // fetch once, since the server-rendered set doesn't reflect them.
    const skippedInitialFetchRef = useRef(false);
    useEffect(() => {
        if (!isMounted) return;
        if (!skippedInitialFetchRef.current) {
            skippedInitialFetchRef.current = true;
            if (isDefaultDiscoverFilters(filtersValue)) {
                return;
            }
        }
        debouncedFetch(filtersValue);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        isMounted,
        filtersValue.selectedCategories,
        filtersValue.selectedGenres,
        filtersValue.dateRange?.from,
        filtersValue.dateRange?.to,
        filtersValue.searchQuery,
    ]);

    // physicalOnly and the free-text query are both client-side-only filters on the event list —
    // mirrors MapExplorer's filteredEventsForMap exactly, since getOpenEventsForMap has no
    // free-text query param and physicalOnly is a pure boolean check on data already fetched.
    const visibleEvents = useMemo(() => {
        let list = results.events;
        if (filtersValue.physicalOnly) {
            list = list.filter((e) => !e.isVirtual);
        }
        const q = filtersValue.searchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter((e) => e.title?.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q));
        }
        return list;
    }, [results.events, filtersValue.physicalOnly, filtersValue.searchQuery]);

    const showArtists = filtersValue.selectedCategories.length === 0 || filtersValue.selectedCategories.includes("users");
    const showEvents = filtersValue.selectedCategories.length === 0 || filtersValue.selectedCategories.includes("events");

    return (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-24 pt-4 md:pt-8">
            <h1 className="text-xl font-semibold text-gray-900">Discover</h1>

            <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center rounded-full bg-white p-1 pl-4 shadow-sm ring-1 ring-black/5">
                    <Search className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search artists and events"
                        value={filtersValue.searchQuery}
                        onChange={(e) => handleFiltersChange({ ...filtersValue, searchQuery: e.target.value })}
                        className="min-w-0 flex-1 border-none bg-transparent px-2 py-2 text-base outline-none focus:ring-0"
                    />
                    {filtersValue.searchQuery && (
                        <button
                            type="button"
                            onClick={() => handleFiltersChange({ ...filtersValue, searchQuery: "" })}
                            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
                            aria-label="Clear search"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
                <SearchFilters
                    value={filtersValue}
                    onChange={handleFiltersChange}
                    open={showAdvancedFilters}
                    onOpenChange={setShowAdvancedFilters}
                    openSection={openAdvancedSection}
                    onOpenSectionChange={setOpenAdvancedSection}
                    isMobile={isMobile}
                />
            </div>

            <CategoryFilterCarousel
                categories={[...DISCOVER_CATEGORIES]}
                categoryCounts={{ users: results.artists.length, events: visibleEvents.length }}
                selectedCategories={filtersValue.selectedCategories}
                onSelectionChange={(next) => handleFiltersChange({ ...filtersValue, selectedCategories: next })}
                hasSearched={true}
                displayLabelMap={DISCOVER_CATEGORY_LABELS}
            />

            <GenreFilterChips
                selectedGenres={filtersValue.selectedGenres}
                onRemove={(genre) =>
                    handleFiltersChange({
                        ...filtersValue,
                        selectedGenres: filtersValue.selectedGenres.filter((g) => g !== genre),
                    })
                }
            />

            {restoredFromStorage && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-orange-50 px-4 py-2.5 text-sm text-orange-900">
                    <span>
                        Showing your saved filters: <strong>{describeFilters(filtersValue)}</strong>
                    </span>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => setShowAdvancedFilters(true)}
                            className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
                        >
                            <SlidersHorizontal className="h-3.5 w-3.5" /> Change
                        </button>
                        <button
                            type="button"
                            onClick={() => handleFiltersChange(DEFAULT_DISCOVER_FILTERS)}
                            className="font-medium underline underline-offset-2"
                        >
                            Reset
                        </button>
                    </div>
                </div>
            )}

            {isLoading && <div className="py-2 text-center text-sm text-gray-500">Updating results…</div>}

            {showArtists && (
                <section className="flex flex-col gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Artists</h2>
                    {results.artists.length === 0 && !isLoading ? (
                        <p className="py-4 text-center text-sm text-gray-500">No artists match these filters yet.</p>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {results.artists.map((artist) => (
                                <ArtistCard key={artist._id as string} artist={artist} />
                            ))}
                        </div>
                    )}
                </section>
            )}

            {showEvents && (
                <section className="flex flex-col gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Events</h2>
                    {visibleEvents.length === 0 && !isLoading ? (
                        <p className="py-4 text-center text-sm text-gray-500">No upcoming events match these filters yet.</p>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {visibleEvents.map((event) => (
                                <DiscoverEventRow key={event._id as string} event={event} />
                            ))}
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}

function DiscoverEventRow({ event }: { event: EventDisplay }) {
    const image = event.images?.[0]?.fileInfo?.url;
    return (
        <Link
            href={event.circle?.handle ? `/circles/${event.circle.handle}/events/${event._id}` : "#"}
            className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5"
        >
            {image ? (
                <img src={image} alt="" className="h-12 w-12 flex-shrink-0 rounded-xl object-cover" />
            ) : (
                <div className="h-12 w-12 flex-shrink-0 rounded-xl bg-gray-100" />
            )}
            <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-gray-900">{event.title}</div>
                <div className="truncate text-sm text-gray-500">
                    {formatEventWhen(event)}
                    {event.circle?.name ? ` · ${event.circle.name}` : ""}
                </div>
            </div>
        </Link>
    );
}
