// Peerify: data-access for audio tracks. Stores storage *keys* only — signed
// playback URLs are derived at request time (see src/lib/audio/audio-token.ts).

import { ObjectId } from "mongodb";
import { Comment, CommentDisplay, Track } from "@/models/models";
import { Comments, Tracks } from "./db";
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

// Comments on a track are always flat (no threading/replies — see PEERIFY_CONTEXT.md).
// A "reply" is just a new top-level comment; parentCommentId is always null.
export const createTrackComment = async (comment: Comment): Promise<Comment> => {
    const result = await Comments.insertOne(comment);
    await Tracks.updateOne({ _id: new ObjectId(comment.trackId!) }, { $inc: { commentCount: 1 } });
    return { ...comment, _id: result.insertedId.toString() };
};

export const getTrackComments = async (trackId: string): Promise<CommentDisplay[]> => {
    const comments = (await Comments.aggregate([
        { $match: { trackId, isDeleted: { $ne: true } } },
        {
            $lookup: {
                from: "circles",
                localField: "createdBy",
                foreignField: "did",
                as: "authorDetails",
            },
        },
        { $unwind: "$authorDetails" },
        {
            $lookup: {
                from: "circles",
                let: {
                    mentionIds: { $ifNull: [{ $map: { input: "$mentions", as: "m", in: "$$m.id" } }, []] },
                },
                pipeline: [
                    { $match: { $expr: { $in: [{ $toString: "$_id" }, "$$mentionIds"] } } },
                    {
                        $project: {
                            _id: { $toString: "$_id" },
                            did: 1,
                            name: 1,
                            picture: 1,
                            handle: 1,
                        },
                    },
                ],
                as: "mentionsDetails",
            },
        },
        { $sort: { createdAt: -1 } },
        {
            $project: {
                _id: { $toString: "$_id" },
                trackId: 1,
                parentCommentId: 1,
                content: 1,
                createdBy: 1,
                createdAt: 1,
                reactions: 1,
                replies: 1,
                isDeleted: 1,
                mentions: 1,
                mentionsDisplay: {
                    $map: {
                        input: { $ifNull: ["$mentions", []] },
                        as: "mention",
                        in: {
                            type: "$$mention.type",
                            id: "$$mention.id",
                            circle: {
                                $arrayElemAt: [
                                    {
                                        $filter: {
                                            input: { $ifNull: ["$mentionsDetails", []] },
                                            as: "circle",
                                            cond: { $eq: ["$$circle._id", "$$mention.id"] },
                                        },
                                    },
                                    0,
                                ],
                            },
                        },
                    },
                },
                author: {
                    did: "$authorDetails.did",
                    name: "$authorDetails.name",
                    picture: "$authorDetails.picture",
                    handle: "$authorDetails.handle",
                },
            },
        },
    ]).toArray()) as CommentDisplay[];

    return comments;
};

// Song comments are flat (no replies), so deletion is always a hard delete —
// unlike deleteComment() for posts, there's never a "has replies" case to soft-delete for.
export const deleteTrackComment = async (commentId: string, trackId: string): Promise<void> => {
    await Comments.deleteOne({ _id: new ObjectId(commentId) });
    await Tracks.updateOne({ _id: new ObjectId(trackId) }, { $inc: { commentCount: -1 } });
};
