// Peerify: data-access for audio tracks. Stores storage *keys* only — signed
// playback URLs are derived at request time (see src/lib/audio/audio-token.ts).

import { ObjectId } from "mongodb";
import { Track } from "@/models/models";
import { Tracks } from "./db";
import { removePrivateObject } from "./storage";

export const createTrack = async (trackData: Omit<Track, "_id">): Promise<Track> => {
    try {
        const toInsert = { ...trackData, createdAt: trackData.createdAt || new Date() };
        const result = await Tracks.insertOne(toInsert as any);
        if (!result.insertedId) {
            throw new Error("Failed to insert track into database.");
        }
        const created = (await Tracks.findOne({ _id: result.insertedId })) as Track | null;
        if (!created) {
            throw new Error("Failed to retrieve created track immediately after insertion.");
        }
        created._id = created._id!.toString();
        return created;
    } catch (error) {
        console.error("Error creating track:", error);
        throw new Error(`Database error creating track: ${error instanceof Error ? error.message : String(error)}`);
    }
};

export const getTracksByCircleId = async (circleId: string): Promise<Track[]> => {
    const tracks = (await Tracks.find({ artistProfileId: circleId }).sort({ createdAt: -1 }).toArray()) as Track[];
    return tracks.map((t) => ({ ...t, _id: t._id!.toString() }));
};

export const getTrackById = async (trackId: string): Promise<Track | null> => {
    if (!ObjectId.isValid(trackId)) {
        return null;
    }
    const track = (await Tracks.findOne({ _id: new ObjectId(trackId) })) as Track | null;
    if (!track) return null;
    track._id = track._id!.toString();
    return track;
};

// Deletes the track document and its underlying private storage objects
// (original + derivative). Best-effort on the storage side.
export const deleteTrack = async (trackId: string): Promise<void> => {
    if (!ObjectId.isValid(trackId)) return;
    const track = (await Tracks.findOne({ _id: new ObjectId(trackId) })) as Track | null;
    if (!track) return;
    await Promise.allSettled([removePrivateObject(track.originalKey), removePrivateObject(track.previewKey)]);
    await Tracks.deleteOne({ _id: new ObjectId(trackId) });
};
