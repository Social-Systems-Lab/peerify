import { Posts, Comments } from "./db";
import { Comment } from "@/models/models";
import { ObjectId } from "mongodb";

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
