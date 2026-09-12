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

const SCROLL_FADE_DURATION_MS = 350;

// Ramps audio.volume down to 0 over SCROLL_FADE_DURATION_MS, then pauses — used for the
// scroll-away path only. audio-manager.ts's exclusivity pause (a different track starting) stays
// an instant .pause(): a new track is about to play immediately there, so fading the old one out
// serves no purpose.
//
// activeFades tracks the rAF handle per element so a second call for the same element (the card
// leaving view again before the first fade finished) cancels the earlier loop instead of running
// two overlapping ones. Each tick also checks audio.paused first — if something else paused this
// element in the meantime (audio-manager's exclusivity handler, or the user tapping play/pause),
// the loop stops adjusting volume rather than fighting whatever already handled it. Commit 2
// (audio-manager.ts) is what makes a later replay start back at full volume, not this function.
function fadeOutAndPause(audio: HTMLAudioElement, activeFades: Map<HTMLAudioElement, number>) {
    const existingFrame = activeFades.get(audio);
    if (existingFrame !== undefined) cancelAnimationFrame(existingFrame);

    const startVolume = audio.volume;
    const startTime = performance.now();

    const step = (now: number) => {
        if (audio.paused) {
            activeFades.delete(audio);
            return;
        }

        const t = Math.min((now - startTime) / SCROLL_FADE_DURATION_MS, 1);
        audio.volume = startVolume * (1 - t);

        if (t < 1) {
            activeFades.set(audio, requestAnimationFrame(step));
        } else {
            activeFades.delete(audio);
            audio.pause();
        }
    };

    activeFades.set(audio, requestAnimationFrame(step));
}

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
    const cardRef = useRef<HTMLDivElement>(null);
    const fadeHandlesRef = useRef<Map<HTMLAudioElement, number>>(new Map());

    // Pause-on-scroll-away, matching the convention elsewhere (e.g. Instagram video). Observes
    // the whole card — compact header plus the expanded CirclePreview content when open — as one
    // element and sweeps for any <audio> inside it (this card's own play button, or a
    // TrackPreviewRow inside the expanded CirclePreview — both render real <audio> tags
    // somewhere in this subtree) rather than tracking a specific one, so it doesn't matter which
    // surface started playing. threshold: 0 means this only fires once literally zero pixels of
    // the card remain on screen, not as soon as any part scrolls past — see the commit report for
    // what that means for a tall expanded card.
    useEffect(() => {
        const node = cardRef.current;
        if (!node) return;
        const activeFades = fadeHandlesRef.current;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) {
                    node.querySelectorAll("audio").forEach((audio) => {
                        if (!audio.paused) fadeOutAndPause(audio, activeFades);
                    });
                }
            },
            { threshold: 0 },
        );
        observer.observe(node);
        return () => {
            observer.disconnect();
            // Component unmounting mid-fade (e.g. the list re-renders this card away) — don't
            // leave an orphaned rAF loop running against a detached element.
            activeFades.forEach((frame) => cancelAnimationFrame(frame));
            activeFades.clear();
        };
    }, []);

    const genre = artist.primaryGenres?.[0];
    // location is stripped server-side (searchDiscoverableCircles) for any personal profile that
    // hasn't opted into mapVisible, so this is frequently absent — display-only when both the
    // artist and viewer have a resolvable point, never a filter.
    const artistLngLat = artist.location?.lngLat as [number, number] | { lng: number; lat: number } | undefined;
    const distanceKm = artistLngLat ? haversineKm(artistLngLat, getUserLocation(user)) : undefined;
    const distanceLabel = distanceKm !== undefined && isFinite(distanceKm) ? `${Math.round(distanceKm)} km away` : undefined;
    const subtitle = [genre, distanceLabel].filter(Boolean).join(" · ") || "Artist";
    // Same two fields CirclePreview shows as its own bio blocks (content-preview.tsx), already
    // present on this list's WithMetric<Circle> payload — no new fetch. Omitted entirely (not a
    // placeholder string) when neither is set, so a bio-less artist's row doesn't grow at all.
    const bio = artist.mission || artist.description;

    return (
        <div ref={cardRef} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
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
                    {bio && <div className="line-clamp-1 text-xs text-gray-400">{bio}</div>}
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

    // The <audio> element is always mounted (see the render below), but `src` only gets a real
    // URL once `track` is set — .play() has to wait for that attribute update to commit, it can't
    // happen inline in the tap handler right after setTrack() (the element would still be
    // pointing at nothing at that moment in the same tick).
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
            {/* Always rendered, never conditionally mounted on `track` — useExclusiveAudio's own
                registration effect (see audio-manager.ts) only runs once, on this component's
                first commit, and only registers if the element already exists at that point.
                Conditionally mounting this on `track` meant it was never actually registered with
                the shared singleton at all: this button neither paused other playing tracks nor
                got paused by them, and its own play/pause listeners (above) were attached to a
                ref that was still null when that effect ran. `src` stays unset (not "") until a
                track loads, so there's nothing to fetch/error on before the first tap. */}
            <audio ref={audioRef} src={track?.streamUrl} preload="none" className="hidden">
                Your browser does not support the audio element.
            </audio>
        </span>
    );
}
