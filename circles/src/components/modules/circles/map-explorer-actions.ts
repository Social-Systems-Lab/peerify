"use server";

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { getOpenEventsForMap, getOpenEventsForList } from "@/lib/data/event";
import { getCircleById } from "@/lib/data/circle";
import { getTracksByCircleId } from "@/lib/data/track";
import { signAudioToken } from "@/lib/audio/audio-token";
import { isPeerifyArtistIdentity, isPeerifyManagedIdentity } from "@/lib/peerify/artist-profile";
import { features } from "@/lib/data/constants";
import { EventDisplay } from "@/models/models";

type RangeInput = { from?: string; to?: string };

/**
 * Fetch open events for map display.
 * - Only includes events with a geocoded location (lngLat) and stage === "open"
 * - If no range provided, defaults to upcoming events (endAt >= now)
 * - If range provided, returns events overlapping the window
 */
export async function getOpenEventsForMapAction(range?: RangeInput): Promise<EventDisplay[]> {
    try {
        const userDid = (await getAuthenticatedUserDid()) || "";
        const parsedRange =
            range && (range.from || range.to)
                ? {
                      from: range.from ? new Date(range.from) : undefined,
                      to: range.to ? new Date(range.to) : undefined,
                  }
                : undefined;

        const events = await getOpenEventsForMap(userDid, parsedRange as any);
        return events || [];
    } catch (err) {
        console.error("getOpenEventsForMapAction error:", err);
        return [];
    }
}

/**
 * Fetch open events for list display (includes virtual and non-geocoded events).
 * - Includes stage === "open"
 * - If no range provided, defaults to upcoming events (endAt >= now)
 * - If range provided, returns events overlapping the window
 * - Applies visibility gating and returns enriched EventDisplay
 */
export async function getOpenEventsForListAction(range?: RangeInput): Promise<EventDisplay[]> {
    try {
        const userDid = (await getAuthenticatedUserDid()) || "";
        const parsedRange =
            range && (range.from || range.to)
                ? {
                      from: range.from ? new Date(range.from) : undefined,
                      to: range.to ? new Date(range.to) : undefined,
                  }
                : undefined;

        const events = await getOpenEventsForList(userDid, parsedRange as any);

        return events || [];
    } catch (err) {
        console.error("getOpenEventsForListAction error:", err);
        return [];
    }
}

export type TrackPreview = {
    id: string;
    title: string;
    durationSec?: number;
    streamUrl: string;
};

const MAX_PREVIEW_TRACKS = 3;

/**
 * Fetch a small set of signed, streamable tracks for an artist circle, for use
 * in the map pin preview panel. Returns [] for non-artist circles or when the
 * viewer isn't allowed to view the circle's music.
 */
export async function getTracksForCirclePreviewAction(circleId: string): Promise<TrackPreview[]> {
    try {
        const circle = await getCircleById(circleId);
        if (!circle || !isPeerifyArtistIdentity(circle)) return [];

        const userDid = (await getAuthenticatedUserDid()) || "";
        const isPublicPeerifyManagedMusic = !userDid && isPeerifyManagedIdentity(circle);
        const canViewMusic = isPublicPeerifyManagedMusic
            ? true
            : userDid
              ? await isAuthorized(userDid, circleId, features.music.view)
              : false;
        if (!canViewMusic) return [];

        const tracks = (await getTracksByCircleId(circleId)).slice(0, MAX_PREVIEW_TRACKS);
        return await Promise.all(
            tracks.map(async (track) => ({
                id: track._id!.toString(),
                title: track.title,
                durationSec: track.durationSec,
                streamUrl: `/api/peerify/audio?t=${encodeURIComponent(
                    await signAudioToken({ trackId: track._id!.toString(), previewKey: track.previewKey }),
                )}`,
            })),
        );
    } catch (err) {
        console.error("getTracksForCirclePreviewAction error:", err);
        return [];
    }
}
