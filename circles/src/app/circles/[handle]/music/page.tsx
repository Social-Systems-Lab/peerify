import { redirect } from "next/navigation";
import { getCircleByHandle } from "@/lib/data/circle";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { features } from "@/lib/data/constants";
import { getTracksByCircleId } from "@/lib/data/track";
import { signAudioToken } from "@/lib/audio/audio-token";
import TrackUploadForm from "@/components/modules/music/track-upload-form";
import AudioPlayer from "@/components/modules/music/audio-player";

type MusicPageProps = {
    params: Promise<{ handle: string }>;
};

export default async function MusicPage(props: MusicPageProps) {
    if (process.env.IS_BUILD === "true") {
        return null;
    }

    const { handle } = await props.params;
    const circle = await getCircleByHandle(handle);
    if (!circle) {
        redirect("/not-found");
    }

    const circleId = (circle._id ?? "").toString();
    const userDid = await getAuthenticatedUserDid();
    const canUpload = await isAuthorized(userDid, circleId, features.settings.edit_about);

    const tracks = await getTracksByCircleId(circleId);

    // Sign a short-lived (1h) streaming URL per track at request time — keys are
    // never exposed; the signed token expires.
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
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
            <h2 className="text-xl font-semibold">Music</h2>

            {canUpload && <TrackUploadForm circleId={circleId} />}

            {tracksWithUrls.length === 0 ? (
                <p className="text-sm text-gray-500">No tracks yet.</p>
            ) : (
                <ul className="flex flex-col gap-4">
                    {tracksWithUrls.map((track) => (
                        <li key={track.id} className="flex flex-col gap-2 rounded-lg border p-4">
                            <span className="font-medium">{track.title}</span>
                            <AudioPlayer src={track.streamUrl} durationSec={track.durationSec} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
