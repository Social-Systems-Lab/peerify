// An event's comments hang off a hidden post (createEvent's "shadow post"), made under the event
// author's personal account. Every visitor gets its id with the event (commentPostId), so it must
// never be shown as a post: that would name the author (Tim, 2026-11-15). The post page sends it to
// the event page, and a shared embed of it is empty.

import type { Post } from "@/models/models";

export const isEventShadowPost = (post: Pick<Post, "postType" | "parentItemType" | "parentItemId">): boolean =>
    post.parentItemType === "event" || post.postType === "event";

// The event page for the post page's redirect; undefined when the post doesn't say which event.
export const eventPathForShadowPost = (
    post: Pick<Post, "parentItemId">,
    circleHandle: string,
): string | undefined =>
    post.parentItemId
        ? `/circles/${encodeURIComponent(circleHandle)}/events/${encodeURIComponent(String(post.parentItemId))}`
        : undefined;
