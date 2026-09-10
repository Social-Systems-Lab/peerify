"use server";

import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { searchDiscoverableCircles } from "@/lib/data/search";
import { getMetricsForCircles } from "@/lib/data/circle";
import { getOpenEventsForMap } from "@/lib/data/event";
import { isPeerifyArtistIdentity } from "@/lib/peerify/artist-profile";
import { Circle, WithMetric, EventDisplay } from "@/models/models";

export type DiscoverResults = {
    artists: WithMetric<Circle>[];
    events: EventDisplay[];
};

export type DiscoverQueryInput = {
    query: string;
    // This screen's own pill set (["users", "events"]) — empty means "All", same convention as
    // MapExplorer's selectedCategories. Never contains "communities"/"offers": Discover only
    // surfaces artists and events, so those two pills are the only values CategoryFilterCarousel
    // is ever given here.
    selectedCategories: string[];
    primaryGenres: string[];
    dateRange?: { from?: string; to?: string };
};

/**
 * Fetches this screen's two result sets in parallel: discoverable artist circles (filtered down
 * from searchDiscoverableCircles' broader result set to isPeerifyArtistIdentity only — Discover
 * is artist-specific, unlike Explore's generic circle search) and open events. Unlike
 * searchContentAction (search/actions.ts), this never short-circuits to [] for an empty
 * query/no genres — an empty/default filter value is exactly what the screen's default "browse"
 * state needs to return a real result set for.
 */
export async function getDiscoverResultsAction(input: DiscoverQueryInput): Promise<DiscoverResults> {
    try {
        const userDid = (await getAuthenticatedUserDid()) || undefined;
        const includeArtists = input.selectedCategories.length === 0 || input.selectedCategories.includes("users");
        const includeEvents = input.selectedCategories.length === 0 || input.selectedCategories.includes("events");
        const primaryGenres = input.primaryGenres.length > 0 ? input.primaryGenres : undefined;

        const artistsPromise = includeArtists
            ? searchDiscoverableCircles({ query: input.query, limit: 40, primaryGenres, viewerDid: userDid })
            : Promise.resolve([] as WithMetric<Circle>[]);

        const range =
            input.dateRange && (input.dateRange.from || input.dateRange.to)
                ? {
                      from: input.dateRange.from ? new Date(input.dateRange.from) : undefined,
                      to: input.dateRange.to ? new Date(input.dateRange.to) : undefined,
                  }
                : undefined;
        const eventsPromise = includeEvents
            ? getOpenEventsForMap(userDid || "", range as any, primaryGenres)
            : Promise.resolve([] as EventDisplay[]);

        const [candidateCircles, events] = await Promise.all([artistsPromise, eventsPromise]);
        const artists = candidateCircles.filter((circle) => isPeerifyArtistIdentity(circle));

        if (userDid && artists.length > 0) {
            await getMetricsForCircles(artists, userDid);
        }

        return { artists, events: events || [] };
    } catch (error) {
        console.error("getDiscoverResultsAction error:", error);
        return { artists: [], events: [] };
    }
}
