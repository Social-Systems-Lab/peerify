import DiscoverScreen from "@/components/modules/discover/discover-screen";
import { getDiscoverResultsAction } from "@/components/modules/discover/actions";

// Server-rendered first paint with the screen's true-default query (no query text, no genres, no
// date range, no category narrowing) — the same "browse everything" defaults getDiscoverResultsAction
// already returns for an empty filter value, so this is not special-cased data, just fetched
// once up front instead of waiting for the client's post-mount effect.
export default async function DiscoverPage() {
    const initialResults = await getDiscoverResultsAction({
        query: "",
        selectedCategories: [],
        primaryGenres: [],
    });

    return <DiscoverScreen initialResults={initialResults} />;
}
