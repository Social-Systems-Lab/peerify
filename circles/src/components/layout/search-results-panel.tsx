"use client";

import React, { useMemo } from "react";
import { useAtom } from "jotai";
import { sidePanelSearchStateAtom, contentPreviewAtom, zoomContentAtom, userAtom } from "@/lib/data/atoms";
import { Calendar as CalendarIcon } from "lucide-react";
import Indicators from "@/components/utils/indicators";
import { CirclePicture } from "@/components/modules/circles/circle-picture";
import { Content, ContentPreviewData, EventDisplay } from "@/models/models";
import { format } from "date-fns";
import { isPeerifyArtistIdentity, isPeerifyVenueIdentity } from "@/lib/peerify/artist-profile";

const SEARCH_CATEGORY_LABELS: Record<string, string> = {
    users: "artists",
    communities: "venues",
    events: "events",
};

// Empty array (or omitted) means "All" — mirrors selectedCategories' own empty-means-All
// convention throughout map-explorer.tsx, this atom's writer.
const getSearchCategoriesLabel = (categories: string[]) =>
    categories.map((category) => SEARCH_CATEGORY_LABELS[category] ?? category).join(" & ");

// Defense-in-depth only: searchable is already enforced at the query level
// (searchDiscoverableCircles). This guard exists in case a personal profile
// ever reaches this component via some other path. Mirrors map.tsx's
// isSuppressedUserProfile, but keyed to `searchable` instead of `mapVisible`.
// viewerIsAdmin (sourced from userAtom.isAdmin, same trusted client state the admin nav link
// already reads in global-nav.tsx) lets superadmins see the real result, mirroring the
// query-level bypass already in searchDiscoverableCircles.
const isSuppressedSearchProfile = (item: any, viewerIsAdmin: boolean): boolean =>
    !viewerIsAdmin && item?.circleType === "user" && item?.searchable !== true;

const isEventItem = (item: any): boolean => "startAt" in item && Boolean(item?.title);

// Section order mirrors the top Artists/Venues/Events pills. "Other" catches everything a
// Category multi-select can't target directly (plain personal/fan profiles, projects, posts) —
// items filterCirclesByCategory already lets through unfiltered under "All" today; sectioning
// the list must not make those silently disappear, so they get their own catch-all section
// rather than being dropped.
const RESULT_SECTIONS: { key: "artists" | "venues" | "events" | "other"; label: string }[] = [
    { key: "artists", label: "Artists" },
    { key: "venues", label: "Venues" },
    { key: "events", label: "Events" },
    { key: "other", label: "Other" },
];

const groupSearchResultItems = (items: any[]) => {
    const groups: Record<"artists" | "venues" | "events" | "other", any[]> = {
        artists: [],
        venues: [],
        events: [],
        other: [],
    };
    for (const item of items) {
        if (isEventItem(item)) {
            groups.events.push(item);
        } else if (isPeerifyVenueIdentity(item)) {
            groups.venues.push(item);
        } else if (isPeerifyArtistIdentity(item)) {
            groups.artists.push(item);
        } else {
            groups.other.push(item);
        }
    }
    return groups;
};

const ResultListItem: React.FC<{ item: any; viewerIsAdmin: boolean; onClick: (item: any) => void }> = ({
    item,
    viewerIsAdmin,
    onClick,
}) => {
    const suppressed = isSuppressedSearchProfile(item, viewerIsAdmin);
    const pictureItem = suppressed ? { ...item, name: "Unavailable", picture: undefined, images: undefined } : item;

    return (
        <li
            className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 hover:bg-gray-100"
            onClick={() => onClick(item)}
            title={item.location?.lngLat ? "Click to focus map and view details" : "Click to view details"}
        >
            <div className="relative">
                <CirclePicture circle={pictureItem} size="40px" showTypeIndicator={true} />
            </div>
            <div className="relative flex-1 overflow-hidden pl-2">
                <div className="truncate p-0 text-sm font-medium">
                    {"startAt" in item && (item as any).title ? (
                        <span className="inline-flex items-center gap-1">
                            <CalendarIcon className="h-3.5 w-3.5 text-gray-600" />
                            {(item as any).title}
                        </span>
                    ) : suppressed ? (
                        "Unavailable"
                    ) : (
                        "name" in item && item.name ? item.name : "Post"
                    )}
                </div>
                <div className="mt-1 line-clamp-2 p-0 text-xs text-gray-500">
                    {"startAt" in item && (item as any).startAt
                        ? `${format(new Date((item as any).startAt), "PPpp")}${
                              "endAt" in item && (item as any).endAt
                                  ? " — " + format(new Date((item as any).endAt), "PPpp")
                                  : ""
                          }`
                        : suppressed
                          ? ""
                          : "description" in item
                            ? (item.description ?? ("mission" in item ? (item as any).mission : "") ?? "")
                            : "content" in item && typeof (item as any).content === "string"
                              ? (item as any).content.substring(0, 70) + ((item as any).content.length > 70 ? "..." : "")
                              : ""}
                </div>
                {"metrics" in item && item.metrics && (
                    <div className="flex flex-row pt-1">
                        <Indicators className="pointer-events-none" metrics={item.metrics} />
                        <div className="flex-1" />
                    </div>
                )}
            </div>
        </li>
    );
};

export default function SearchResultsPanel() {
    const [searchState] = useAtom(sidePanelSearchStateAtom);
    const [, setContentPreview] = useAtom(contentPreviewAtom);
    const [, setZoomContent] = useAtom(zoomContentAtom);
    const [user] = useAtom(userAtom);
    const viewerIsAdmin = user?.isAdmin === true;

    // Stable reference across renders (unlike a bare `|| []` fallback) so it doesn't defeat the
    // useMemo hooks below that depend on it.
    const items = useMemo(() => searchState.items || [], [searchState.items]);
    const groupedItems = useMemo(() => groupSearchResultItems(items), [items]);
    // Stable reference across renders (unlike a bare `?? []` fallback) so it doesn't defeat the
    // useMemo hooks below that depend on it.
    const selectedCategories = useMemo(() => searchState.selectedCategories ?? [], [searchState.selectedCategories]);
    const filterSummary = useMemo(() => {
        const parts: string[] = [];

        if (selectedCategories.length > 0) {
            parts.push(getSearchCategoriesLabel(selectedCategories));
        }

        if (searchState.selectedDateLabel) {
            parts.push(searchState.selectedDateLabel);
        }

        return parts.join(" · ");
    }, [selectedCategories, searchState.selectedDateLabel]);

    const emptyState = useMemo(() => {
        const trimmedQuery = searchState.query.trim();
        const context: string[] = [];

        if (trimmedQuery) {
            context.push(`for "${trimmedQuery}"`);
        }

        if (selectedCategories.length > 0) {
            context.push(`in ${getSearchCategoriesLabel(selectedCategories)}`);
        }

        if (searchState.selectedDateLabel) {
            context.push(`inside ${searchState.selectedDateLabel}`);
        }

        return {
            title: `No ${selectedCategories.length > 0 ? getSearchCategoriesLabel(selectedCategories) : "results"} found`,
            description:
                context.length > 0
                    ? `Nothing matched ${context.join(" ")}. Try broadening the query or removing a filter.`
                    : "Try a broader query or switch result types.",
        };
    }, [searchState.query, selectedCategories, searchState.selectedDateLabel]);

    // No header in side panel per design; keep internal state if needed later

    const handleItemClick = (item: any) => {
        // Zoom map if possible
        if (item?.location?.lngLat) {
            setZoomContent(item as unknown as Content);
        }
        // Open right-side content preview
        if (item && item.startAt && item.title) {
            const preview: ContentPreviewData = {
                type: "event",
                content: item as EventDisplay,
                props: { circleHandle: item?.circle?.handle || "" },
            };
            setContentPreview(preview);
        } else {
            const preview: ContentPreviewData = {
                // circleType can be "user" | "circle" | "project". Default to "circle".
                type: (item.circleType || "circle") as any,
                content: item as any,
                props: { source: "search" },
            } as any;
            setContentPreview(preview);
        }
    };

    return (
        <div className="flex h-full w-full flex-col bg-white">
            <div className="sticky top-0 z-10 border-b bg-white px-3 py-2">
                <div className="mb-2 text-sm font-semibold">Search results</div>
                {searchState.query && <div className="text-sm text-gray-700">Query: “{searchState.query}”</div>}
                <div className="mt-1 text-xs text-gray-500">
                    {searchState.isSearching
                        ? "Searching…"
                        : `${items.length} result${items.length === 1 ? "" : "s"}`}
                </div>
                {filterSummary && <div className="mt-1 text-xs text-gray-500">Filters: {filterSummary}</div>}
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-hover stable-scrollbar">
                {searchState.isSearching && <div className="p-4 text-sm text-gray-600">Loading…</div>}
                {!searchState.isSearching && items.length === 0 && searchState.hasSearched && (
                    <div className="p-4">
                        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center">
                            <div className="text-sm font-medium text-gray-900">{emptyState.title}</div>
                            <div className="mt-2 text-sm text-gray-500">{emptyState.description}</div>
                        </div>
                    </div>
                )}
                {!searchState.isSearching && items.length > 0 && (
                    <div className="pb-2">
                        {RESULT_SECTIONS.map(({ key, label }) => {
                            const sectionItems = groupedItems[key];
                            if (sectionItems.length === 0) return null;
                            return (
                                <div key={key}>
                                    <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        {label} · {sectionItems.length}
                                    </div>
                                    <ul className="space-y-1">
                                        {sectionItems.map((item: any) => (
                                            <ResultListItem
                                                key={item._id}
                                                item={item}
                                                viewerIsAdmin={viewerIsAdmin}
                                                onClick={handleItemClick}
                                            />
                                        ))}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
