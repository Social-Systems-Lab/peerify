import DiscoverScreen from "@/components/modules/discover/discover-screen";
import { getDiscoverResultsAction } from "@/components/modules/discover/actions";
import { DEFAULT_DISCOVER_FILTERS } from "@/components/modules/discover/constants";

// Server-rendered first paint with the screen's true-default query — reads straight from
// DEFAULT_DISCOVER_FILTERS (Artists-only) rather than its own hardcoded shape, so this can never
// drift from what DiscoverScreen itself treats as default (it did, briefly: this used to hardcode
// selectedCategories: [] — "All" — which fetched events on every fresh page load only for that
// data to go unused once the client mounted at the Artists-only default).
export default async function DiscoverPage() {
    const initialResults = await getDiscoverResultsAction({
        query: DEFAULT_DISCOVER_FILTERS.searchQuery,
        selectedCategories: DEFAULT_DISCOVER_FILTERS.selectedCategories,
        primaryGenres: DEFAULT_DISCOVER_FILTERS.selectedGenres,
    });

    return <DiscoverScreen initialResults={initialResults} />;
}
