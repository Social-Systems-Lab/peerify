// Peerify: server actions for song comments. Mirrors the Noticeboard post-comment
// pattern in feeds/actions.ts, but keyed by trackId instead of postId — comments on a
// song are always flat (no threading; a "reply" is just a new top-level comment).
"use server";

import { Comment, CommentDisplay, commentSchema } from "@/models/models";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { features } from "@/lib/data/constants";
import { getTrackById, createTrackComment, getTrackComments, deleteTrackComment } from "@/lib/data/track";
import { getComment, updateComment, extractMentions } from "@/lib/data/feed";
import { validateMentionPermissions } from "@/components/modules/feeds/actions";
import { getCircleById } from "@/lib/data/circle";
import { getUserByDid } from "@/lib/data/user";
import { resolveActingAuthor } from "@/lib/data/acting-identity";
import { notifyTrackComment, notifyTrackCommentMentions, notifyTrackCommentReply } from "@/lib/data/notifications";

export async function createTrackCommentAction(
    trackId: string,
    content: string,
    postAsCircleId?: string,
    quotedCommentId?: string,
): Promise<{ success: boolean; message?: string; comment?: CommentDisplay }> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to comment" };
    }

    try {
        const track = await getTrackById(trackId);
        if (!track) {
            return { success: false, message: "Song not found" };
        }

        const authorized = await isAuthorized(userDid, track.artistProfileId, features.music.comment);
        if (!authorized) {
            return { success: false, message: "You are not authorized to comment on this song" };
        }

        const user = await getUserByDid(userDid);
        if (!user) {
            return { success: false, message: "User not found" };
        }

        // Attribute to whichever persona the client says is currently active — re-verified
        // server-side, never trusted blindly (see resolveActingAuthor).
        const { authorDid, actingCircle } = await resolveActingAuthor(userDid, postAsCircleId);
        const author = actingCircle ?? user;

        const mentions = extractMentions(content);
        await validateMentionPermissions(userDid, mentions);

        // Only trust a quotedCommentId that actually belongs to this same track — for
        // reply-notification targeting only, never rendered or turned into a thread.
        let quotedComment = quotedCommentId ? await getComment(quotedCommentId) : null;
        if (quotedComment?.trackId !== trackId) {
            quotedComment = null;
        }

        let comment: CommentDisplay = {
            trackId,
            parentCommentId: null,
            content,
            createdBy: authorDid,
            createdAt: new Date(),
            reactions: {},
            replies: 0,
            mentions,
            quotedCommentId: quotedComment?._id,
            author,
        };

        try {
            await commentSchema.parseAsync(comment);
        } catch (validationError) {
            console.error("Song comment validation failed:", validationError);
            return { success: false, message: "Invalid comment data" };
        }

        const newComment = await createTrackComment(comment);
        comment._id = newComment._id;

        try {
            const artistCircle = await getCircleById(track.artistProfileId);
            if (artistCircle) {
                await notifyTrackComment(track, artistCircle, newComment, user);

                if (quotedComment) {
                    await notifyTrackCommentReply(quotedComment, track, newComment, user);
                }

                if (mentions.length > 0) {
                    const mentionedCircles = (await Promise.all(mentions.map((m) => getCircleById(m.id)))).filter(
                        (circle) => circle !== null,
                    );
                    if (mentionedCircles.length > 0) {
                        await notifyTrackCommentMentions(newComment, track, user, mentionedCircles);
                    }
                }
            }
        } catch (notificationError) {
            console.error("Failed to send song comment notifications:", notificationError);
        }

        return { success: true, message: "Comment posted successfully", comment };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Failed to post comment." };
    }
}

export async function getTrackCommentsAction(
    trackId: string,
): Promise<{ success: boolean; comments?: CommentDisplay[]; message?: string }> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to view comments" };
    }

    try {
        const track = await getTrackById(trackId);
        if (!track) {
            return { success: false, message: "Song not found" };
        }

        const authorized = await isAuthorized(userDid, track.artistProfileId, features.music.view);
        if (!authorized) {
            return { success: false, message: "You are not authorized to view comments on this song" };
        }

        const comments = await getTrackComments(trackId);
        return { success: true, comments };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Failed to get comments." };
    }
}

export async function editTrackCommentAction(
    commentId: string,
    updatedContent: string,
): Promise<{ success: boolean; message?: string }> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to edit a comment" };
    }

    try {
        const comment = await getComment(commentId);
        if (!comment || !comment.trackId) {
            return { success: false, message: "Comment not found" };
        }

        if (comment.createdBy !== userDid) {
            return { success: false, message: "You are not authorized to edit this comment" };
        }

        const updatedMentions = extractMentions(updatedContent);
        await validateMentionPermissions(userDid, updatedMentions);
        await updateComment(commentId, updatedContent, updatedMentions);

        try {
            const track = await getTrackById(comment.trackId);
            const previousMentions = comment.mentions?.map((m) => m.id) || [];
            const newMentions = updatedMentions.filter((mention) => !previousMentions.includes(mention.id));
            if (track && newMentions.length > 0) {
                const user = await getUserByDid(userDid);
                const mentionedCircles = (await Promise.all(newMentions.map((m) => getCircleById(m.id)))).filter(
                    (circle) => circle !== null,
                );
                if (user && mentionedCircles.length > 0) {
                    await notifyTrackCommentMentions(
                        { ...comment, content: updatedContent, mentions: updatedMentions },
                        track,
                        user,
                        mentionedCircles,
                    );
                }
            }
        } catch (notificationError) {
            console.error("Failed to send mention notifications:", notificationError);
        }

        return { success: true, message: "Comment updated successfully" };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Failed to edit comment." };
    }
}

export async function deleteTrackCommentAction(commentId: string): Promise<{ success: boolean; message?: string }> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to delete a comment" };
    }

    try {
        const comment = await getComment(commentId);
        if (!comment || !comment.trackId) {
            return { success: false, message: "Comment not found" };
        }

        const track = await getTrackById(comment.trackId);
        if (!track) {
            return { success: false, message: "Song not found" };
        }

        const canModerate = await isAuthorized(userDid, track.artistProfileId, features.music.manage);
        if (comment.createdBy !== userDid && !canModerate) {
            return { success: false, message: "You are not authorized to delete this comment" };
        }

        await deleteTrackComment(commentId, comment.trackId);

        return { success: true, message: "Comment deleted successfully" };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Failed to delete comment." };
    }
}
