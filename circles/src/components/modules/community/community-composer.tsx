// community-composer.tsx
"use client";

import React, { useState, useTransition, useRef, useEffect } from "react";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { Circle, Feed } from "@/models/models";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { MultiImageUploader, ImageItem } from "@/components/forms/controls/multi-image-uploader";
import { UNVERIFIED_PROFILE_EXPLAINER, canPerformRestrictedAction } from "@/lib/auth/verification";
import { createPostAction } from "@/components/modules/feeds/actions";
import { useToast } from "@/components/ui/use-toast";
import { UserPicture } from "@/components/modules/members/user-picture";

type CommunityComposerProps = {
    circle: Circle;
    feed: Feed;
    onPostCreated: () => void;
};

// Deliberately minimal — Community's agreed MVP fields are just text body +
// images (no title, no location, no link preview, no poll, no visibility
// picker). This does NOT reuse PostForm: PostForm brings all of those
// Noticeboard-specific fields, and has its own bespoke image dropzone rather
// than the shared MultiImageUploader this brief asked to reuse.
export function CommunityComposer({ circle, feed, onPostCreated }: CommunityComposerProps) {
    const [user] = useAtom(userAtom);
    const [content, setContent] = useState("");
    const [images, setImages] = useState<ImageItem[]>([]);
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();
    const [isExpanded, setIsExpanded] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Collapse back to the discreet single-line state on an outside click,
    // unless there's unsaved text/images — same click-outside pattern already
    // used elsewhere for dismissible UI (see map.tsx's style menu).
    useEffect(() => {
        if (!isExpanded) return;
        const handlePointerDown = (event: MouseEvent) => {
            if (containerRef.current?.contains(event.target as Node)) return;
            if (!content.trim() && images.length === 0) {
                setIsExpanded(false);
            }
        };
        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, [isExpanded, content, images]);

    const handleSubmit = () => {
        if (!content.trim() && images.length === 0) {
            toast({
                title: "Error",
                description: "Write something or add an image before posting.",
                variant: "destructive",
            });
            return;
        }

        startTransition(async () => {
            const formData = new FormData();
            formData.append("circleId", circle._id);
            formData.append("postType", "community");
            formData.append("content", content);
            formData.append("userGroups", "everyone");
            images.forEach((image) => {
                if (image.file) {
                    formData.append("media", image.file);
                }
            });

            const response = await createPostAction(formData);
            if (!response.success) {
                toast({
                    title: response.message || "Failed to create post",
                    variant: "destructive",
                });
                return;
            }

            toast({ title: "Posted to Community", variant: "success" });
            setContent("");
            setImages([]);
            setIsExpanded(false);
            onPostCreated();
        });
    };

    return (
        <div
            ref={containerRef}
            className={`mb-4 flex flex-col gap-3 rounded-[15px] border-0 bg-white transition-all ${
                isExpanded ? "p-4 shadow-lg" : "p-2 shadow-sm"
            }`}
        >
            <div className="flex items-start gap-3">
                <UserPicture name={user?.name} picture={user?.picture?.url} size="40px" />
                <div className="flex-1">
                    {isExpanded && !canPerformRestrictedAction(user) && (
                        <p className="mb-2 text-sm text-destructive">{UNVERIFIED_PROFILE_EXPLAINER}</p>
                    )}
                    {isExpanded ? (
                        <Textarea
                            autoFocus
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder={`Share something with ${circle.name}'s community...`}
                            className="min-h-[100px] resize-none rounded-xl border-gray-200 px-3 py-2 text-base shadow-none focus-visible:ring-0"
                        />
                    ) : (
                        <input
                            type="text"
                            readOnly
                            onFocus={() => setIsExpanded(true)}
                            onClick={() => setIsExpanded(true)}
                            placeholder={`Share something with ${circle.name}'s community...`}
                            className="w-full cursor-pointer rounded-full bg-gray-100 p-2 pl-4 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    )}
                    {isExpanded && (
                        <div className="mt-3">
                            <MultiImageUploader onChange={setImages} maxImages={5} previewMode="compact" />
                        </div>
                    )}
                </div>
            </div>
            {isExpanded && (
                <div className="flex justify-end">
                    <Button
                        className="rounded-full bg-[hsl(var(--button-primary))] px-6 text-[hsl(var(--button-primary-foreground))] hover:bg-[hsl(var(--button-primary-hover))]"
                        onClick={handleSubmit}
                        disabled={isPending}
                    >
                        {isPending ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Posting...
                            </>
                        ) : (
                            "Post"
                        )}
                    </Button>
                </div>
            )}
        </div>
    );
}
