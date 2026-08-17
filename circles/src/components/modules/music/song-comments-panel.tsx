"use client";

import React, { KeyboardEvent, useEffect, useMemo, useState, useTransition } from "react";
import { Circle, CommentDisplay, UserPrivate } from "@/models/models";
import { Button } from "@/components/ui/button";
import { Edit, Loader2, MoreHorizontal, Quote, Trash2 } from "lucide-react";
import { UNVERIFIED_PROFILE_EXPLAINER } from "@/lib/auth/verification";
import { getPublishTime } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
const TextareaAutosize = require("react-textarea-autosize");
import { useToast } from "@/components/ui/use-toast";
import { isAuthorized } from "@/lib/auth/client-auth";
import { features } from "@/lib/data/constants";
import { useActingIdentity } from "@/lib/utils/acting-identity";
import { MentionsInput, Mention } from "react-mentions";
import RichText from "@/components/modules/feeds/RichText";
import { UserPicture } from "@/components/modules/members/user-picture";
import {
    defaultMentionsInputStyle,
    defaultMentionStyle,
    getMentionsPortalHost,
    handleMentionQuery,
    renderCircleSuggestion,
} from "@/components/modules/feeds/post-list";
import {
    createTrackCommentAction,
    getTrackCommentsAction,
    editTrackCommentAction,
    deleteTrackCommentAction,
} from "./comment-actions";

const QUOTE_SNIPPET_MAX = 140;

const truncateForQuote = (content: string): string => {
    // Strip mention markup ([display](/circles/id)) down to the display text for readability.
    const plain = content.replace(/\[([^\]]+)\]\(\/circles\/[^)]+\)/g, "$1");
    return plain.length > QUOTE_SNIPPET_MAX ? `${plain.slice(0, QUOTE_SNIPPET_MAX).trimEnd()}…` : plain;
};

type SongCommentItemProps = {
    comment: CommentDisplay;
    user: UserPrivate | null;
    circle: Circle;
    onDelete: (commentId: string) => void;
    onEdited: (commentId: string, content: string) => void;
    onQuote: (snippet: string) => void;
};

const SongCommentItem: React.FC<SongCommentItemProps> = ({ comment, user, circle, onDelete, onEdited, onQuote }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(comment.content);
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();

    const isAuthor = user && comment.createdBy === user.did;
    const canModerate = isAuthorized(user ?? undefined, circle, features.music.manage);

    const handleEditSubmit = () => {
        if (isPending || editContent === comment.content) {
            setIsEditing(false);
            return;
        }
        const originalContent = comment.content;
        onEdited(comment._id!, editContent);
        setIsEditing(false);

        startTransition(async () => {
            const result = await editTrackCommentAction(comment._id!, editContent);
            if (!result.success) {
                onEdited(comment._id!, originalContent);
                toast({ title: "Update failed", description: result.message, variant: "destructive" });
            }
        });
    };

    const handleDelete = () => {
        if (isPending) return;
        startTransition(async () => {
            const result = await deleteTrackCommentAction(comment._id!);
            if (result.success) {
                onDelete(comment._id!);
            } else {
                toast({ title: "Delete failed", description: result.message, variant: "destructive" });
            }
        });
    };

    const handleEditKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleEditSubmit();
        } else if (e.key === "Escape") {
            e.preventDefault();
            setEditContent(comment.content);
            setIsEditing(false);
        }
    };

    return (
        <div className="group flex items-start gap-2 py-2">
            <UserPicture
                name={comment.author.name}
                picture={comment.author.picture?.url}
                circleType={comment.author.circleType}
                size="32px"
            />
            <div className="flex w-full max-w-[85%] flex-col">
                <div className="inline-block rounded-[15px] bg-gray-100 p-2">
                    <div className="text-sm font-semibold">{comment.author.name}</div>
                    {isEditing ? (
                        <MentionsInput
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            onKeyDown={handleEditKeyDown}
                            className="flex-grow rounded-[20px] bg-gray-200"
                            style={defaultMentionsInputStyle}
                            autoFocus
                            suggestionsPortalHost={getMentionsPortalHost()}
                            allowSuggestionsAboveCursor={true}
                            forceSuggestionsAboveCursor={true}
                        >
                            <Mention
                                trigger="@"
                                data={handleMentionQuery}
                                style={defaultMentionStyle}
                                displayTransform={(id, display) => `${display}`}
                                renderSuggestion={renderCircleSuggestion}
                                markup="[__display__](/circles/__id__)"
                            />
                        </MentionsInput>
                    ) : (
                        <div className="text-sm">
                            <RichText content={comment.content} mentions={comment.mentionsDisplay} />
                        </div>
                    )}
                </div>
                <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                    <div>{getPublishTime(comment.createdAt)}</div>
                    <div
                        onClick={() => onQuote(truncateForQuote(comment.content))}
                        className="flex cursor-pointer items-center gap-1 font-medium hover:underline"
                    >
                        <Quote className="h-3 w-3" />
                        Quote &amp; reply
                    </div>
                </div>
            </div>

            {(isAuthor || canModerate) && !isEditing && (
                <div className="relative ml-auto self-start opacity-0 transition-opacity group-hover:opacity-100">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full">
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {isAuthor && (
                                <DropdownMenuItem onClick={() => setIsEditing(true)}>
                                    <Edit className="mr-2 h-4 w-4" />
                                    <span>Edit</span>
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={handleDelete} className="text-red-600">
                                <Trash2 className="mr-2 h-4 w-4" />
                                <span>Delete</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )}
        </div>
    );
};

type SongCommentsPanelProps = {
    trackId: string;
    circle: Circle;
    user: UserPrivate | null;
    onCommentCountChange?: (count: number) => void;
};

export const SongCommentsPanel: React.FC<SongCommentsPanelProps> = ({ trackId, circle, user, onCommentCountChange }) => {
    const [comments, setComments] = useState<CommentDisplay[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newContent, setNewContent] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { toast } = useToast();
    const postingAsCircle = useActingIdentity();

    const canComment = isAuthorized(user ?? undefined, circle, features.music.comment);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        getTrackCommentsAction(trackId).then((result) => {
            if (cancelled) return;
            if (result.success && result.comments) {
                setComments(result.comments);
            } else {
                setError(result.message || "Failed to load comments.");
            }
            setIsLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [trackId]);

    const updateComments = (updater: (prev: CommentDisplay[]) => CommentDisplay[]) => {
        setComments((prev) => {
            const next = updater(prev);
            onCommentCountChange?.(next.length);
            return next;
        });
    };

    const handleAddComment = () => {
        if (!newContent.trim() || isSubmitting || !user) return;

        const content = newContent.trim();
        setNewContent("");
        setIsSubmitting(true);

        const tempComment: CommentDisplay = {
            _id: `temp-song-comment-${comments.length}-${content.length}`,
            trackId,
            content,
            createdAt: new Date(),
            author: (postingAsCircle as Circle) ?? { name: user.name, did: user.did } as Circle,
            createdBy: postingAsCircle?.did ?? user.did!,
            parentCommentId: null,
            reactions: {},
            replies: 0,
        };

        updateComments((prev) => [tempComment, ...prev]);

        (async () => {
            try {
                const result = await createTrackCommentAction(trackId, content, postingAsCircle?._id);
                if (result.success && result.comment) {
                    const newComment = { ...result.comment, author: (postingAsCircle as Circle) ?? result.comment.author };
                    updateComments((prev) => prev.map((c) => (c._id === tempComment._id ? newComment : c)));
                } else {
                    updateComments((prev) => prev.filter((c) => c._id !== tempComment._id));
                    toast({
                        title: "Comment failed",
                        description: result.message || "Failed to post comment.",
                        variant: "destructive",
                    });
                }
            } catch (err) {
                updateComments((prev) => prev.filter((c) => c._id !== tempComment._id));
                toast({ title: "Comment failed", description: "An error occurred.", variant: "destructive" });
            } finally {
                setIsSubmitting(false);
            }
        })();
    };

    const handleCommentKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleAddComment();
        }
    };

    const handleQuote = (snippet: string) => {
        setNewContent(`> ${snippet}\n\n`);
    };

    return (
        <div className="flex flex-col gap-2">
            <h3 className="text-lg font-semibold">Comments</h3>

            {isLoading && (
                <div className="flex items-center justify-center py-4 text-gray-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading comments...
                </div>
            )}
            {error && <div className="text-red-600">{error}</div>}

            {!isLoading && !error && (
                <>
                    <div className="flex max-h-[50vh] flex-col divide-y overflow-y-auto">
                        {comments.length > 0 ? (
                            comments.map((comment) => (
                                <SongCommentItem
                                    key={comment._id}
                                    comment={comment}
                                    user={user}
                                    circle={circle}
                                    onDelete={(id) => updateComments((prev) => prev.filter((c) => c._id !== id))}
                                    onEdited={(id, content) =>
                                        updateComments((prev) =>
                                            prev.map((c) => (c._id === id ? { ...c, content } : c)),
                                        )
                                    }
                                    onQuote={handleQuote}
                                />
                            ))
                        ) : (
                            <div className="py-4 text-sm text-gray-500">No comments yet — be the first.</div>
                        )}
                    </div>

                    {user && canComment && (
                        <div className="mt-2 flex items-start gap-2 border-t pt-4">
                            <UserPicture
                                name={(postingAsCircle || user).name}
                                picture={(postingAsCircle || user).picture?.url}
                                circleType={(postingAsCircle || user).circleType}
                                size="32px"
                            />
                            <div className="flex-grow">
                                <MentionsInput
                                    value={newContent}
                                    onChange={(e) => setNewContent(e.target.value)}
                                    onKeyDown={handleCommentKeyDown}
                                    placeholder="Write a comment..."
                                    className="flex-grow rounded-[20px] bg-gray-100"
                                    style={defaultMentionsInputStyle}
                                    disabled={isSubmitting}
                                    suggestionsPortalHost={getMentionsPortalHost()}
                                    allowSuggestionsAboveCursor={true}
                                    forceSuggestionsAboveCursor={true}
                                >
                                    <Mention
                                        trigger="@"
                                        data={handleMentionQuery}
                                        style={defaultMentionStyle}
                                        displayTransform={(id, display) => `${display}`}
                                        renderSuggestion={renderCircleSuggestion}
                                        markup="[__display__](/circles/__id__)"
                                    />
                                </MentionsInput>
                                <Button
                                    onClick={handleAddComment}
                                    disabled={isSubmitting || !newContent.trim()}
                                    size="sm"
                                    className="mt-2"
                                >
                                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    Post
                                </Button>
                            </div>
                        </div>
                    )}
                    {user && !canComment && (
                        <p className="mt-2 text-sm text-destructive">{UNVERIFIED_PROFILE_EXPLAINER}</p>
                    )}
                    {!user && <div className="mt-2 text-sm text-gray-500">Log in to comment.</div>}
                </>
            )}
        </div>
    );
};

export default SongCommentsPanel;
