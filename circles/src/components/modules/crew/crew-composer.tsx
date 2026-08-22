// crew-composer.tsx
"use client";

import React, { useState, useTransition, useRef, useEffect } from "react";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { Circle, Feed } from "@/models/models";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, Megaphone } from "lucide-react";
import { MultiImageUploader, ImageItem } from "@/components/forms/controls/multi-image-uploader";
import { createPostAction } from "@/components/modules/feeds/actions";
import { broadcastToCrewAction } from "@/components/modules/crew-applications/actions";
import { useToast } from "@/components/ui/use-toast";
import { UserPicture } from "@/components/modules/members/user-picture";
import { useActingIdentity } from "@/lib/utils/acting-identity";
import { getPeerifyIdentityAvatarUrl, isPeerifyManagedIdentity } from "@/lib/peerify/artist-profile";

type CrewComposerProps = {
    circle: Circle;
    feed: Feed;
    onPostCreated: () => void;
};

// Modeled directly on community-composer.tsx — same minimal text+images shape, same
// acting-identity handling. Two differences: postType "crew", and userGroups set to
// ["admins","moderators","crew"] rather than "everyone" — post.userGroups is a real,
// separately-enforced per-post visibility check (see getPosts/getPostsWithMetrics in
// feed.ts), so a Crew post must not carry "everyone" the way Community's does, or it would
// leak through any other query path that reads post.userGroups without the feed-level
// crew_space.view gate in front of it.
export function CrewComposer({ circle, feed, onPostCreated }: CrewComposerProps) {
    const [user] = useAtom(userAtom);
    const actingIdentity = useActingIdentity();
    const canPostAsActingIdentity = actingIdentity?._id === circle._id || actingIdentity?._id === user?._id;
    const postingAsCircle = actingIdentity?._id === circle._id ? circle : actingIdentity;
    const [content, setContent] = useState("");
    const [images, setImages] = useState<ImageItem[]>([]);
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();
    const [isExpanded, setIsExpanded] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Same client-side membership check crew-feed.tsx's own canPost() uses (not a fresh server
    // round-trip) — admin/moderator status is the viewer's own long-standing role, not something
    // that changes out-of-band mid-session the way an application's approval status does, so the
    // userAtom-staleness concern that applies elsewhere in Crew doesn't apply here.
    const membership = user?.memberships?.find((m) => m.circleId === circle._id);
    const isAdminOrMod = membership?.userGroups?.some((group) => group === "admins" || group === "moderators") ?? false;
    const [sendAsBroadcast, setSendAsBroadcast] = useState(false);

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

    // Guards against a real, confirmed duplicate-post bug: two clicks fired close enough
    // together (a genuine rapid double-click, or a double-tap) both ran to completion before
    // React's next render committed isPending=true to the Button's disabled attribute, so both
    // called createPostAction independently. isPending updates asynchronously (it's scheduled by
    // startTransition, not applied synchronously), so relying on disabled={isPending} alone
    // leaves that race window open. A ref is checked/set synchronously in the same tick as the
    // click, closing it — reproduced and confirmed fixed via two raw dispatched click events
    // before this guard existed (2 Post docs) vs. after (1).
    const isSubmittingRef = useRef(false);

    const handleSubmit = () => {
        if (isSubmittingRef.current) return;

        // Broadcasts are text-only (broadcastToCrewAction takes a plain message, no media
        // handling) — the image uploader is hidden whenever the checkbox is checked, so this
        // simplifies to "must have content" on that branch instead of "content or an image."
        const hasNothingToPost = sendAsBroadcast ? !content.trim() : !content.trim() && images.length === 0;
        if (hasNothingToPost) {
            toast({
                title: "Error",
                description: "Write something or add an image before posting.",
                variant: "destructive",
            });
            return;
        }

        isSubmittingRef.current = true;
        startTransition(async () => {
            try {
                if (sendAsBroadcast) {
                    const response = await broadcastToCrewAction(circle, content);
                    if (!response.success) {
                        toast({
                            title: response.message || "Failed to send broadcast",
                            variant: "destructive",
                        });
                        return;
                    }

                    toast({
                        title: "Broadcast sent",
                        description: `Sent to ${response.recipientCount} Crew member${response.recipientCount === 1 ? "" : "s"}.`,
                        variant: "success",
                    });
                } else {
                    const formData = new FormData();
                    formData.append("circleId", circle._id);
                    formData.append("postAsCircleId", circle._id);
                    formData.append("postType", "crew");
                    formData.append("content", content);
                    formData.append("userGroups", "admins");
                    formData.append("userGroups", "moderators");
                    formData.append("userGroups", "crew");
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

                    toast({ title: "Posted to Crew", variant: "success" });
                }

                setContent("");
                setImages([]);
                setSendAsBroadcast(false);
                setIsExpanded(false);
                onPostCreated();
            } finally {
                isSubmittingRef.current = false;
            }
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
                <UserPicture
                    name={postingAsCircle?.name ?? user?.name}
                    picture={
                        postingAsCircle && isPeerifyManagedIdentity(postingAsCircle)
                            ? getPeerifyIdentityAvatarUrl(postingAsCircle)
                            : postingAsCircle?.picture?.url ?? user?.picture?.url
                    }
                    size="40px"
                />
                <div className="flex-1">
                    {!canPostAsActingIdentity && (
                        <p className="mb-2 text-sm text-muted-foreground">
                            {`You're acting as ${actingIdentity?.name ?? "another persona"}, which can't post in ${circle.name}'s Crew space. Switch back to ${circle.name}${user && user._id !== circle._id ? " or your own profile" : ""} to post here.`}
                        </p>
                    )}
                    {isExpanded ? (
                        <Textarea
                            autoFocus
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder={`Share something with ${circle.name}'s Crew...`}
                            className="min-h-[100px] resize-none rounded-xl border-gray-200 px-3 py-2 text-base shadow-none focus-visible:ring-0"
                        />
                    ) : (
                        <input
                            type="text"
                            readOnly
                            disabled={!canPostAsActingIdentity}
                            onFocus={() => canPostAsActingIdentity && setIsExpanded(true)}
                            onClick={() => canPostAsActingIdentity && setIsExpanded(true)}
                            placeholder={`Share something with ${circle.name}'s Crew...`}
                            className="w-full cursor-pointer rounded-full bg-gray-100 p-2 pl-4 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                    )}
                    {/* Broadcasts don't support media (broadcastToCrewAction is text-only) — hide
                        the uploader instead of letting an admin attach an image that would then
                        be silently dropped. */}
                    {isExpanded && !sendAsBroadcast && (
                        <div className="mt-3">
                            <MultiImageUploader onChange={setImages} maxImages={5} previewMode="compact" />
                        </div>
                    )}
                </div>
            </div>
            {/* Admin/moderator-only — calls the same broadcastToCrewAction already built for the
                Settings → Crew Applications flow, not a duplicate implementation. Reduces the
                friction of navigating away from the feed for something that might be needed
                spontaneously. */}
            {isExpanded && isAdminOrMod && (
                <div className="flex items-center gap-2 pl-[52px]">
                    <Checkbox
                        id="crew-send-as-broadcast"
                        checked={sendAsBroadcast}
                        onCheckedChange={(checked) => setSendAsBroadcast(checked === true)}
                    />
                    <Label htmlFor="crew-send-as-broadcast" className="flex items-center gap-1.5 text-sm font-normal">
                        <Megaphone className="h-3.5 w-3.5" />
                        Send as Broadcast — pins this post and notifies the whole crew
                    </Label>
                </div>
            )}
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
                                {sendAsBroadcast ? "Sending…" : "Posting..."}
                            </>
                        ) : sendAsBroadcast ? (
                            "Send Broadcast"
                        ) : (
                            "Post"
                        )}
                    </Button>
                </div>
            )}
        </div>
    );
}
