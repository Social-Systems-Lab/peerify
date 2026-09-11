"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronUp, Loader2, Pause, Play } from "lucide-react";
import { userAtom } from "@/lib/data/atoms";
import { haversineKm, getUserLocation } from "@/lib/utils";
import { useExclusiveAudio } from "@/lib/audio/use-exclusive-audio";
import { getTracksForCirclePreviewAction, TrackPreview } from "@/components/modules/circles/map-explorer-actions";
import { CirclePicture } from "@/components/modules/circles/circle-picture";
import { CirclePreview } from "@/components/layout/content-preview";
import { Circle, WithMetric } from "@/models/models";

type ArtistCardProps = {
    artist: WithMetric<Circle>;
};

/**
 * Compact, expandable row for the Discover artist list. The collapsed header (thumbnail, name,
 * genre/distance, one play button) is the new part; expanding it reveals the existing
 * CirclePreview component wholesale (song list, Follow/Bookmark, Pledge/Join Crew) rather than
 * duplicating any of that markup — same component ContentPreview mounts for a map-pin/search
 * click, just embedded in this list instead of a floating panel.
 */
export default function ArtistCard({ artist }: ArtistCardProps) {
    const [expanded, setExpanded] = useState(false);
    const user = useAtomValue(userAtom);

    const genre = artist.primaryGenres?.[0];
    // location is stripped server-side (searchDiscoverableCircles) for any personal profile that
    // hasn't opted into mapVisible, so this is frequently absent — display-only when both the
    // artist and viewer have a resolvable point, never a filter.
    const artistLngLat = artist.location?.lngLat as [number, number] | { lng: number; lat: number } | undefined;
    const distanceKm = artistLngLat ? haversineKm(artistLngLat, getUserLocation(user)) : undefined;
    const distanceLabel = distanceKm !== undefined && isFinite(distanceKm) ? `${Math.round(distanceKm)} km away` : undefined;
    const subtitle = [genre, distanceLabel].filter(Boolean).join(" · ") || "Artist";

    return (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            {/* A <div role="button">, not a real <button> — ArtistCardPlayButton below renders its
                own <button>, and nested <button> elements are invalid HTML (the browser would
                auto-close this one early, breaking the tap target for whatever follows the play
                button in the DOM). Keyboard-operable via onKeyDown for the same reason. */}
            <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded((v) => !v)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpanded((v) => !v);
                    }
                }}
                className="flex w-full cursor-pointer items-center gap-3 p-3 text-left"
                aria-expanded={expanded}
                aria-label={expanded ? `Collapse ${artist.name}` : `Expand ${artist.name}`}
            >
                <CirclePicture circle={artist} size="56px" openPreview={false} />
                <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-gray-900">{artist.name}</div>
                    <div className="truncate text-sm text-gray-500">{subtitle}</div>
                </div>
                <ArtistCardPlayButton circleId={artist._id as string} artistName={artist.name || "artist"} />
                {expanded ? (
                    <ChevronUp className="h-5 w-5 flex-shrink-0 text-gray-400" />
                ) : (
                    <ChevronDown className="h-5 w-5 flex-shrink-0 text-gray-400" />
                )}
            </div>
            {expanded && (
                <div className="border-t border-gray-100">
                    <CirclePreview circle={artist} circleType={artist.circleType || "user"} source="search" />
                </div>
            )}
        </div>
    );
}

// A single play button for the artist's top track — reuses the same exclusive-audio mechanism
// TrackPreviewRow uses (mutual exclusion with every other playing track site-wide) without
// pulling in that row's full markup (title/duration/comment-count/ovate button), which doesn't
// fit a compact single-button row.
//
// Lazy, not eager: getTracksForCirclePreviewAction only runs once the user actually taps this
// button — matching TrackPreviewList's own lazy-on-open pattern — not on mount for every visible
// card. Expanding the card does NOT also trigger this fetch: CirclePreview's own TrackPreviewList
// fetches independently once expanded, so this button staying idle until tapped doesn't leave a
// gap — it just means the compact and expanded song data are fetched by whichever the visitor
// reaches first, never both.
//
// Since we don't know in advance whether this artist has any tracks (that's the whole point of
// not fetching eagerly), the button starts in a generic, always-visible "idle" state rather than
// staying hidden until data arrives. First tap: brief "loading" spinner while the fetch resolves,
// then either becomes an interactive play/pause control or disappears (this artist has no
// tracks). Every tap after that first one is instant — the fetched track stays cached in state.
function ArtistCardPlayButton({ circleId, artistName }: { circleId: string; artistName: string }) {
    const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty">("idle");
    const [track, setTrack] = useState<TrackPreview | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useExclusiveAudio();
    // Set right before the lazy fetch kicks off on a user tap; consumed once the fetched track's
    // <audio> element mounts (see the effect below) to start playback automatically — without
    // this flag, a track loaded some other way (there isn't one today, but nothing here should
    // assume it stays that way) would also auto-play, which is not what "tap play" should do.
    const autoPlayOnLoadRef = useRef(false);

    useEffect(() => {
        const el = audioRef.current;
        if (!el) return;
        const onPlay = () => setIsPlaying(true);
        const onPauseOrEnd = () => setIsPlaying(false);
        el.addEventListener("play", onPlay);
        el.addEventListener("pause", onPauseOrEnd);
        el.addEventListener("ended", onPauseOrEnd);
        return () => {
            el.removeEventListener("play", onPlay);
            el.removeEventListener("pause", onPauseOrEnd);
            el.removeEventListener("ended", onPauseOrEnd);
        };
    }, [audioRef]);

    // The <audio> element only mounts once `track` is set (below), so audioRef.current is null
    // until this effect's own render commits — .play() has to wait for that, it can't happen
    // inline in the tap handler right after setTrack().
    useEffect(() => {
        if (track && autoPlayOnLoadRef.current) {
            autoPlayOnLoadRef.current = false;
            audioRef.current?.play();
        }
    }, [track, audioRef]);

    if (status === "empty") return null;

    const handleTap = async (e: React.MouseEvent) => {
        e.stopPropagation();

        if (status === "idle") {
            setStatus("loading");
            autoPlayOnLoadRef.current = true;
            const tracks = await getTracksForCirclePreviewAction(circleId);
            const first = tracks[0] ?? null;
            if (!first) {
                autoPlayOnLoadRef.current = false;
            }
            setTrack(first);
            setStatus(first ? "ready" : "empty");
            return;
        }

        if (status !== "ready") return;
        const el = audioRef.current;
        if (!el) return;
        if (el.paused) {
            el.play();
        } else {
            el.pause();
        }
    };

    return (
        <span className="flex-shrink-0">
            <button
                type="button"
                onClick={handleTap}
                disabled={status === "loading"}
                aria-label={isPlaying ? `Pause ${artistName}` : `Play ${artistName}`}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 text-white transition-colors hover:bg-orange-600 disabled:opacity-70"
            >
                {status === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : isPlaying ? (
                    <Pause className="h-4 w-4" />
                ) : (
                    <Play className="h-4 w-4 pl-0.5" />
                )}
            </button>
            {track && (
                <audio ref={audioRef} src={track.streamUrl} preload="none" className="hidden">
                    Your browser does not support the audio element.
                </audio>
            )}
        </span>
    );
}
