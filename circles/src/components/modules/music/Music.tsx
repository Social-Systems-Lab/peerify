// components/modules/music/Music.tsx
"use server";

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { features } from "@/lib/data/constants";
import { getTracksByCircleId } from "@/lib/data/track";
import { signAudioToken } from "@/lib/audio/audio-token";
import TrackUploadForm from "@/components/modules/music/track-upload-form";
import AudioPlayer from "@/components/modules/music/audio-player";
import TrackDeleteButton from "@/components/modules/music/track-delete-button";
import { Circle } from "@/models/models";
import { isPeerifyManagedIdentity } from "@/lib/peerify/artist-profile";

const MAX_TRACKS_PER_ARTIST = 3;

type Props = {
    circle: Circle;
};

export default async function MusicModule({ circle }: Props) {
    const userDid = await getAuthenticatedUserDid();
    const isPublicPeerifyManagedMusic = !userDid && isPeerifyManagedIdentity(circle);

    if (!userDid && !isPublicPeerifyManagedMusic) {
        return (
            <div className="p-4">
                <h2 className="mb-2 text-xl font-semibold">Music</h2>
                <p className="text-gray-600">Please sign in to view music.</p>
            </div>
        );
    }

    if (!isPublicPeerifyManagedMusic) {
        const canViewMusic = await isAuthorized(userDid, circle._id!.toString(), features.music.view);
        if (!canViewMusic) {
            return (
                <div className="p-6 text-center">
                    <h2 className="mb-2 text-xl font-semibold">Access Denied</h2>
                    <p className="text-gray-600">You don&apos;t have permission to view music in this circle.</p>
                </div>
            );
        }
    }

    const canUpload = userDid
        ? await isAuthorized(userDid, circle._id!.toString(), features.music.upload)
        : false;

    const circleId = circle._id!.toString();
    const tracks = await getTracksByCircleId(circleId);

    const tracksWithUrls = await Promise.all(
        tracks.map(async (track) => ({
            id: track._id!.toString(),
            title: track.title,
            durationSec: track.durationSec,
            streamUrl: `/api/peerify/audio?t=${encodeURIComponent(
                await signAudioToken({ trackId: track._id!.toString(), previewKey: track.previewKey }),
            )}`,
        })),
    );

    return (
        <div className="space-y-4 p-2 md:p-4">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
                <h2 className="text-xl font-semibold">Music</h2>

                {canUpload &&
                    (tracksWithUrls.length >= MAX_TRACKS_PER_ARTIST ? (
                        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-800">
                            You&apos;ve reached the {MAX_TRACKS_PER_ARTIST}-track limit. Delete a track to upload another.
                        </p>
                    ) : (
                        <>
                            <TrackUploadForm circleId={circleId} />
                            <p className="text-sm font-medium text-gray-600">
                                {tracksWithUrls.length} of {MAX_TRACKS_PER_ARTIST} tracks used
                            </p>
                        </>
                    ))}

                {tracksWithUrls.length === 0 ? (
                    <p className="text-sm text-gray-500">No tracks yet.</p>
                ) : (
                    <ul className="flex flex-col gap-4">
                        {tracksWithUrls.map((track) => (
                            <li key={track.id} className="flex flex-col gap-2 rounded-lg border p-4">
                                <span className="font-medium">{track.title}</span>
                                <AudioPlayer src={track.streamUrl} durationSec={track.durationSec} />
                                {canUpload && <TrackDeleteButton trackId={track.id} title={track.title} />}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
