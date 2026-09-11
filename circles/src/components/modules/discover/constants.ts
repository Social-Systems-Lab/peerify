import { SearchFiltersValue } from "@/components/modules/search/search-filters";

// Plain module (no "use client") so the server page (page.tsx) can import this shared default
// without crossing into discover-screen.tsx's client boundary — a server component importing a
// named export from a "use client" file has no established precedent elsewhere in this codebase,
// and risks the value coming through as a client reference rather than the plain object it is.
//
// Artists-only, not "All" ([]) — Discover's primary purpose is artist discovery (reflected in its
// headphones nav icon), so a first-time visitor should land on that, not a mixed artists+events
// view.
export const DEFAULT_DISCOVER_FILTERS: SearchFiltersValue = {
    selectedCategories: ["users"],
    selectedGenres: [],
    selectedOfferTypes: [],
    dateRange: undefined,
    physicalOnly: false,
    searchQuery: "",
};
