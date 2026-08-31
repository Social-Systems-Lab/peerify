"use client";

import { Heart, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrackUploadForm } from "@/components/modules/music/track-upload-form";
import type { Track } from "@/models/models";

// Mirrors the existing cap in src/components/modules/music/{Music.tsx,actions.ts} — not
// exported from either, so duplicated here rather than reaching into that module's internals.
const MAX_TRACKS_PER_ARTIST = 3;

type SongsStepProps = {
    circleId: string;
    tracks: Track[];
    onContinue: () => void;
    onSkip: () => void;
};

// Frame A-SONGS. A nudge, not a gate: skipping has no effect on the four
// isPilotArtistCircleReadyToPublish/getPilotArtistCircleReadiness checks or on Publish
// availability — tracks are never referenced by that readiness logic. Reuses the existing
// ffmpeg-backed upload pipeline (TrackUploadForm -> uploadTrackAction) as-is; the form calls
// router.refresh() on a successful upload, which re-runs this page's server component and
// passes a fresh `tracks` prop back down, so the list below updates without any local list
// state of our own.
export function SongsStep({ circleId, tracks, onContinue, onSkip }: SongsStepProps) {
    const atCap = tracks.length >= MAX_TRACKS_PER_ARTIST;

    return (
        <div className="space-y-6">
            {tracks.length > 0 ? (
                <ul className="space-y-2">
                    {tracks.map((track) => (
                        <li
                            key={String(track._id)}
                            className="flex items-center gap-2 rounded-lg border p-3 text-sm font-medium"
                        >
                            <Music className="h-4 w-4 shrink-0 text-muted-foreground" />
                            {track.title}
                        </li>
                    ))}
                </ul>
            ) : null}

            <p className="text-xs text-muted-foreground">
                {tracks.length} of {MAX_TRACKS_PER_ARTIST} songs added
            </p>

            {atCap ? (
                <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                    You&apos;ve added the max of {MAX_TRACKS_PER_ARTIST} for now — you can swap tracks later from the
                    Music tab.
                </p>
            ) : (
                <>
                    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
                        <Heart className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                        <p className="text-sm font-semibold">
                            Good enough to upload. Even a simple live recording works great — people want to hear
                            you the way they&apos;d hear you if you played in their living room. You can always
                            replace it with a better version later.
                        </p>
                    </div>
                    <TrackUploadForm circleId={circleId} />
                </>
            )}

            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                <Button type="button" variant="outline" className="sm:flex-1" onClick={onSkip}>
                    Skip for now — I&apos;ll add songs later
                </Button>
                <Button type="button" className="sm:flex-1" onClick={onContinue}>
                    Continue
                </Button>
            </div>
        </div>
    );
}
