import { Posts, Comments } from "./db";
import { Comment } from "@/models/models";
import { ObjectId } from "mongodb";

/**
 * Get a discussion with comments
 */
export async function getDiscussionWithComments(id: string) {
    const pipeline = [
        { $match: { _id: new ObjectId(id), postType: "discussion" } },
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
                from: "feeds",
                localField: "feedId",
                foreignField: "_id",
                as: "feed",
            },
        },
        { $unwind: { path: "$feed", preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: "circles",
                localField: "circleId",
                foreignField: "_id",
                as: "circle",
            },
        },
        { $unwind: { path: "$circle", preserveNullAndEmptyArrays: true } },
    ];

    const results = await Posts.aggregate(pipeline).toArray();
    if (!results || results.length === 0) return null;
    const discussion: any = results[0];
    discussion._id = discussion._id.toString();

    const comments = await Comments.find({ postId: id }).toArray();
    discussion.comments = comments.map((c: any) => ({
        ...c,
        _id: c._id.toString(),
    }));

    return discussion;
}

/**
 * Add a comment to a discussion (if not closed)
 */
export async function addCommentToDiscussion(discussionId: string, data: Partial<Comment>) {
    const discussion = await Posts.findOne({ _id: new ObjectId(discussionId), postType: "discussion" });
    if (!discussion || discussion.closed) {
        throw new Error("Forum post is closed or not found");
    }
    const result = await Comments.insertOne({
        ...data,
        postId: discussionId,
        createdAt: new Date(),
        createdBy: data.createdBy!,
        content: data.content!,
        parentCommentId: data.parentCommentId ?? null,
        reactions: data.reactions ?? {},
        replies: 0,
    } as Comment);

    // Update the lastActivityAt field on the parent discussion post
    await Posts.updateOne({ _id: new ObjectId(discussionId) }, { $set: { lastActivityAt: new Date() } });

    return { _id: result.insertedId.toString(), ...data, postId: discussionId, createdAt: new Date(), replies: 0 };
}
