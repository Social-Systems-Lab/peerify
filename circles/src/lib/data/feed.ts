// feed.ts - Feed data access functions
import { Feeds, Posts, Comments, Reactions, Circles, Members, Proposals, Issues, Tasks, Events } from "./db"; // Added Tasks
import { ObjectId } from "mongodb";
import {
    Feed,
    Post,
    PostDisplay,
    Comment,
    CommentDisplay,
    Circle,
    Mention,
    SortingOptions,
    ProposalDisplay,
    IssueDisplay,
    FundingAskDisplay,
    EventDisplay,
    TaskDisplay, // Added TaskDisplay
    Location,
    Media,
    Feature,
} from "@/models/models";
import {
    getCircleById,
    SAFE_CIRCLE_PROJECTION,
    IDENTITY_CIRCLE_PROJECTION,
    updateCircle,
    getCircleByHandle,
    resolveViewerIsAdmin,
} from "./circle";
import { redactCircleLocationForViewer, viewerBypassesLocationRedaction, type LocationViewerContext } from "../utils";
import { toPublicLocation } from "../utils/public-circle";
import { getUserByDid } from "./user";
import { getMetrics } from "../utils/metrics";
import { deleteVbdPost, upsertVbdPosts } from "./vdb";
import { getProposalById } from "./proposal";
import { getIssueById } from "./issue";
import { getFundingAskDocumentById, getFundingCirclePermissions, isFundingAskVisibleToViewer } from "./funding";
import { sdgs } from "./sdgs";
import { isAuthorized } from "@/lib/auth/auth";
import { features, getPostViewFeature } from "./constants";

export const getFeedsByCircleId = async (circleId: string): Promise<Feed[]> => {
    const feeds = await Feeds.find({
        circleId,
    }).toArray();
    return feeds;
};

export const getFeedsByCircleIds = async (circleIds: string[]): Promise<Feed[]> => {
    if (circleIds.length === 0) {
        return [];
    }

    const feeds = await Feeds.find({
        circleId: { $in: circleIds },
    }).toArray();
    return feeds;
};

export const getAccessibleFeedIdsForUser = async (userDid: string, circleHandle?: string): Promise<string[]> => {
    if (circleHandle) {
        const circle = await getCircleByHandle(circleHandle);
        if (!circle?._id) {
            return [];
        }

        const circleId = circle._id.toString();
        const membership = await Members.findOne({ userDid, circleId }, { projection: { _id: 0, userGroups: 1 } });
        const memberGroups = membership?.userGroups ?? [];

        const feeds = await getFeedsByCircleId(circleId);
        // A feed tagged "everyone" is public and must be accessible regardless of
        // membership, same as post-level "everyone" bypasses membership in canUserViewPost/getPosts.
        return feeds
            .filter(
                (feed) =>
                    feed.userGroups.includes("everyone") || feed.userGroups.some((group) => memberGroups.includes(group)),
            )
            .map((feed) => feed._id?.toString())
            .filter((feedId): feedId is string => Boolean(feedId));
    }

    const memberships = await Members.find(
        { userDid },
        { projection: { _id: 0, circleId: 1, userGroups: 1 } },
    ).toArray();

    const circleIds = [...new Set(memberships.map((membership) => membership.circleId).filter(Boolean))];
    const objectIds = circleIds
        .filter((circleId) => ObjectId.isValid(circleId))
        .map((circleId) => new ObjectId(circleId));
    const circles =
        objectIds.length > 0
            ? await Circles.find({ _id: { $in: objectIds } }, { projection: { _id: 1, handle: 1 } }).toArray()
            : [];
    const accessibleCircleIds = new Set(
        circles.filter((circle) => circle.handle !== "default").map((circle) => circle._id.toString()),
    );

    const membershipsByCircleId = new Map<string, string[]>();
    for (const membership of memberships) {
        if (accessibleCircleIds.has(membership.circleId)) {
            membershipsByCircleId.set(membership.circleId, membership.userGroups ?? []);
        }
    }

    const memberFeeds = await getFeedsByCircleIds([...membershipsByCircleId.keys()]);
    const accessibleFeedIds = new Set(
        memberFeeds
            .filter(
                (feed) =>
                    feed.userGroups.includes("everyone") ||
                    membershipsByCircleId.get(feed.circleId)?.some((group) => feed.userGroups.includes(group)),
            )
            .map((feed) => feed._id?.toString())
            .filter((feedId): feedId is string => Boolean(feedId)),
    );

    // "everyone"-tagged feeds are public and must be included even for circles the
    // viewer doesn't follow/isn't a member of — membership must never gate public content.
    const publicFeeds = await getPublicFeeds();
    for (const feed of publicFeeds) {
        const feedId = feed._id?.toString();
        if (feedId) {
            accessibleFeedIds.add(feedId);
        }
    }

    return [...accessibleFeedIds];
};

export async function getPublicFeeds(): Promise<Feed[]> {
    // Keep this export
    const feeds = await Feeds.find({ userGroups: "everyone" }).toArray();
    return feeds;
}

// Make sure getPublicUserFeed is also exported
export const getPublicUserFeed = async (userDid: string): Promise<Feed | null> => {
    const user = await getUserByDid(userDid);
    if (!user) {
        return null;
    }

    const feed = (await Feeds.findOne({
        circleId: user._id.toString(),
        handle: "default",
        userGroups: "everyone",
    })) as Feed;

    if (feed?._id) {
        feed._id = feed?._id.toString();
    }

    return feed;
};

export function extractMentions(content: string): Mention[] {
    const mentionPattern = /\[([^\]]+)\]\(\/circles\/([^)]+)\)/g;
    let match;
    const mentions: Mention[] = [];

    while ((match = mentionPattern.exec(content)) !== null) {
        //const display = match[1];
        const id = match[2];
        mentions.push({ type: "circle", id });
    }

    return mentions;
}

export const createFeed = async (feed: Feed): Promise<Feed> => {
    const result = await Feeds.insertOne(feed);
    return { ...feed, _id: result.insertedId };
};

export const getFeed = async (feedId: string): Promise<Feed | null> => {
    let feed = (await Feeds.findOne({ _id: new ObjectId(feedId) })) as Feed;
    if (feed) {
        feed._id = feed._id.toString();
    }
    return feed;
};

export const getFeedByHandle = async (circleId: string, feedHandle: string | undefined): Promise<Feed | null> => {
    // if handle is empty then return the default feed
    let feed: Feed;
    if (!feedHandle) {
        feed = (await Feeds.findOne({ circleId, handle: "default" })) as Feed;
    } else {
        feed = (await Feeds.findOne({ circleId, handle: feedHandle })) as Feed;
    }
    if (feed?._id) {
        feed._id = feed._id.toString();
    }
    return feed;
};

export const getFeeds = async (circleId: string): Promise<Feed[]> => {
    let feeds = await Feeds.find({
        circleId,
    }).toArray();
    feeds.forEach((feed: Feed) => {
        if (feed._id) {
            feed._id = feed._id.toString();
        }
    });
    return feeds;
};

export const createDefaultFeed = async (circleId: string): Promise<Feed | null> => {
    let circle = await getCircleById(circleId);
    if (!circle) {
        return null;
    }

    // Only create a single default feed per circle
    let defaultFeed = await getFeedByHandle(circleId, "default");
    if (!defaultFeed) {
        defaultFeed = {
            name: "Circle Noticeboard",
            handle: "default",
            circleId,
            userGroups: ["admins", "moderators", "members", "everyone"],
            createdAt: new Date(),
        };
        defaultFeed = await createFeed(defaultFeed);
    }

    return defaultFeed;
};

// Lazy-create only — there is no backfill script. A circle's Community feed
// is created the first time it's actually needed (its first postType:
// "community" post), same convention as other falsy-undefined-until-used
// circle defaults. Mirrors createDefaultFeed's shape exactly.
export const createCommunityFeed = async (circleId: string): Promise<Feed | null> => {
    let circle = await getCircleById(circleId);
    if (!circle) {
        return null;
    }

    // Only create a single community feed per circle
    let communityFeed = await getFeedByHandle(circleId, "community");
    if (!communityFeed) {
        communityFeed = {
            name: "Community",
            handle: "community",
            circleId,
            userGroups: ["admins", "moderators", "members", "everyone"],
            createdAt: new Date(),
        };
        communityFeed = await createFeed(communityFeed);
    }

    return communityFeed;
};

// Lazy-create only — there is no backfill script. A circle's Crew feed is created the first
// time it's actually needed (its first postType: "crew" post), same convention as
// createCommunityFeed. userGroups deliberately excludes "everyone"/"members" — unlike
// Community, this feed is not meant to be visible to plain followers.
export const createCrewFeed = async (circleId: string): Promise<Feed | null> => {
    let circle = await getCircleById(circleId);
    if (!circle) {
        return null;
    }

    // Only create a single crew feed per circle
    let crewFeed = await getFeedByHandle(circleId, "crew");
    if (!crewFeed) {
        crewFeed = {
            name: "Crew",
            handle: "crew",
            circleId,
            userGroups: ["admins", "moderators", "crew"],
            createdAt: new Date(),
        };
        crewFeed = await createFeed(crewFeed);
    }

    return crewFeed;
};

export const createPost = async (post: Post): Promise<Post> => {
    const result = await Posts.insertOne(post);
    let newPost = { ...post, _id: result.insertedId.toString() } as Post;

    // upsert post
    // get post with author details
    let author = await getUserByDid(post.createdBy);
    try {
        const { sdgs: sdgIds, ...restOfNewPost } = newPost;
        const populatedSdgs = sdgIds ? sdgs.filter((s) => sdgIds.includes(s._id)) : [];
        const postForVdb = {
            ...restOfNewPost,
            sdgs: populatedSdgs,
            author: author!,
            circleType: "post" as const,
        };
        await upsertVbdPosts([postForVdb as PostDisplay]);
    } catch (e) {
        console.error("Failed to upsert post embedding", e);
    }
    return newPost;
};

export const deletePost = async (postId: string): Promise<void> => {
    await Posts.deleteOne({ _id: new ObjectId(postId) });

    // delete post
    try {
        await deleteVbdPost(postId);
    } catch (e) {
        console.error("Failed to delete post embedding", e);
    }

    // delete comments
    await Comments.deleteMany({ postId });
};

// pinned is a generic Post field, not discussion-specific, so this is usable by any postType's
// moderate action.
export const pinPost = async (postId: string, pinned: boolean): Promise<void> => {
    await Posts.updateOne({ _id: new ObjectId(postId) }, { $set: { pinned } });
};

// Called by broadcastToCrewAction before creating/pinning a new broadcast, so only the newest one
// stays pinned. Scoped to isCrewMessage: true specifically — a manually-pinned ordinary post
// (pinned via the pin/unpin dropdown, isCrewMessage undefined) is untouched. updateMany rather
// than assuming exactly one: correct either way if more than one somehow ended up pinned, no-ops
// harmlessly if none did. Only flips `pinned`; content, comments, reactions are untouched, so it
// simply falls back into its normal chronological position via the existing rank-based ordering
// once unpinned — no explicit re-sort needed.
export const unpinPreviousCrewMessages = async (feedId: string): Promise<void> => {
    await Posts.updateMany({ feedId, isCrewMessage: true, pinned: true }, { $set: { pinned: false } });
};

export const getPost = async (postId: string): Promise<Post | null> => {
    let post = (await Posts.findOne({ _id: new ObjectId(postId) })) as Post;
    if (post) {
        post._id = post._id.toString();
    }
    return post;
};

export const canUserViewPost = async (post: Post, userDid?: string): Promise<boolean> => {
    const feed = await getFeed(post.feedId);
    if (!feed) {
        return false;
    }

    // Was hardcoded to features.feed.view (Noticeboard) regardless of postType — harmless for
    // an "everyone" post (the final post.userGroups check below still gated correctly), but a
    // real bug for a non-"everyone" Community/Crew post on a circle without the Noticeboard
    // module enabled: even an admin got a hard "Access denied: feed" before ever reaching the
    // per-post userGroups check. Found via the standalone /post/{postId} page 403ing on a
    // freshly-created Crew broadcast post.
    const canViewFeed = await isAuthorized(userDid, feed.circleId, getPostViewFeature(post.postType));
    if (!canViewFeed) {
        return false;
    }

    const author = await getUserByDid(post.createdBy);
    if (!author) {
        return false;
    }

    if (!author.isVerified && !author.isMember && post.createdBy !== userDid) {
        return false;
    }

    if (!post.userGroups || post.userGroups.length === 0 || post.userGroups.includes("everyone")) {
        return true;
    }

    if (!userDid) {
        return false;
    }

    const membership = await Members.findOne({ userDid, circleId: feed.circleId });
    if (!membership) {
        return false;
    }

    const memberGroups = membership.userGroups ?? [];
    return post.userGroups.some((group) => memberGroups.includes(group));
};

async function buildPostDisplayPreview(post: Post): Promise<PostDisplay | null> {
    const author = await getUserByDid(post.createdBy);
    const feed = await getFeed(post.feedId);
    if (!author || !feed) {
        return null;
    }

    const circle = await getCircleById(feed.circleId);
    if (!circle) {
        return null;
    }

    const { sdgs: sdgIds, ...restOfPost } = post;
    const populatedSdgs = sdgIds ? sdgs.filter((sdg) => sdgIds.includes(sdg._id)) : [];

    return {
        ...restOfPost,
        author,
        circle,
        feed,
        circleType: "post",
        sdgs: populatedSdgs,
        sharedPostData: null,
    };
}

export const getShareablePostPreview = async (postId: string, userDid?: string): Promise<PostDisplay | null> => {
    const post = await getPost(postId);
    if (!post) {
        return null;
    }

    const canView = await canUserViewPost(post, userDid);
    if (!canView) {
        return null;
    }

    const postDisplay = await buildPostDisplayPreview(post);
    if (!postDisplay) {
        return null;
    }

    await fetchAndAttachInternalPreviewData([postDisplay], userDid);
    return postDisplay;
};
type LocationBearingAuthor = { did?: string; location?: Location; metadata?: Circle["metadata"] };
type LocationBearingMention = {
    circle?: { did?: string; location?: Location; metadata?: Circle["metadata"] } | null;
};
type LocationBearingHighlightedComment = {
    author?: LocationBearingAuthor;
    mentionsDisplay?: LocationBearingMention[];
};
type LocationBearingContent = {
    location?: Location;
    createdBy?: string;
    author?: LocationBearingAuthor;
    circle?: LocationBearingAuthor | null;
    mentionsDisplay?: LocationBearingMention[];
    highlightedComment?: LocationBearingHighlightedComment | null;
    sharedPostData?: LocationBearingContent | null;
};

// Profile locations embedded in posts/comments (authors, mentioned circles, reactors, the post's
// circle) reach anonymous visitors, and nothing in a feed needs more than the city line the
// author side panel shows — so, like the public profile pages (toPublicCircle), street and lngLat
// are dropped whatever precision the owner has stored. Stored precision is mostly LocationPicker's
// "Exact" default, not a disclosure choice. Owner and platform admins keep the full location.
function toFeedProfileLocation(
    owner: Pick<Circle, "location" | "did" | "metadata">,
    viewer: LocationViewerContext,
): Location | undefined {
    if (!owner.location || viewerBypassesLocationRedaction(owner.did, viewer)) return owner.location;
    // redactCircleLocationForViewer, not the plain redactLocationForViewer — the owner can be a
    // venue circle (managed identities post/comment/react as themselves via their own did), which
    // needs the extra addressVisibility-based ceiling (see that function's own comment in lib/utils.ts).
    return toPublicLocation(redactCircleLocationForViewer(owner, viewer));
}

// A post/comment's own geotag: capped at city (no street, no lngLat) for everyone but its author
// and platform admins, regardless of stored precision. Cards only show street + city, and the
// composer's precision slider starts on "Exact", so a stored 3/4 isn't a reliable opt-in.
const GEOTAG_PUBLIC_PRECISION_CEILING = 2; // "city"
function toFeedGeotagLocation(
    location: Location,
    ownerDid: string | undefined,
    ownerMetadata: Circle["metadata"] | undefined,
    viewer: LocationViewerContext,
): Location {
    if (viewerBypassesLocationRedaction(ownerDid, viewer)) return location;
    const ceilinged =
        (location.precision ?? 4) > GEOTAG_PUBLIC_PRECISION_CEILING
            ? { ...location, precision: GEOTAG_PUBLIC_PRECISION_CEILING }
            : location;
    return toPublicLocation(
        redactCircleLocationForViewer({ location: ceilinged, did: ownerDid, metadata: ownerMetadata }, viewer),
    )!;
}

function redactAuthorLocation<A extends LocationBearingAuthor | null | undefined>(
    author: A,
    viewer: LocationViewerContext,
): A {
    if (!author?.location) return author;
    const redacted = toFeedProfileLocation(author, viewer);
    if (redacted === author.location) return author;
    return { ...author, location: redacted };
}

function redactMentionsLocations<M extends LocationBearingMention>(
    mentionsDisplay: M[] | undefined,
    viewer: LocationViewerContext,
): M[] | undefined {
    if (!mentionsDisplay?.length) return mentionsDisplay;
    let changed = false;
    const next = mentionsDisplay.map((mention) => {
        const circle = mention?.circle;
        if (!circle?.location) return mention;
        const redacted = toFeedProfileLocation(circle, viewer);
        if (redacted === circle.location) return mention;
        changed = true;
        return { ...mention, circle: { ...circle, location: redacted } };
    });
    return changed ? next : mentionsDisplay;
}

// Redacts every location embedded in a post/comment payload — its own `location` (owned by
// createdBy, e.g. a geotag the author attached; capped at city), and the profile locations of its
// `author`, its `circle`, each mentioned circle, the same on a nested `highlightedComment`, and
// the same again on a nested `sharedPostData` (location fields only — the rest of that object is
// shaped by getShareablePostPreview) — unless the viewer IS that location's owner or a platform
// admin. Applied once to the plain objects the aggregation returns, rather than
// inside the pipeline itself (these aggregations are already deep enough that adding
// viewer-conditional projection logic in Mongo would be far riskier to get right).
function redactContentLocations<T extends LocationBearingContent>(item: T, viewer: LocationViewerContext): T {
    const next: any = { ...item };
    let changed = false;

    if (item.location) {
        // item.createdBy is always the same did as item.author (author is looked up by
        // `localField: "createdBy", foreignField: "did"` in every aggregation that builds this
        // shape), so item.author's metadata tells us whether this geotag's owner is a venue —
        // no separate lookup needed.
        const redacted = toFeedGeotagLocation(item.location, item.createdBy, item.author?.metadata, viewer);
        if (redacted !== item.location) {
            next.location = redacted;
            changed = true;
        }
    }

    const author = redactAuthorLocation(item.author, viewer);
    if (author !== item.author) {
        next.author = author;
        changed = true;
    }

    const circle = redactAuthorLocation(item.circle, viewer);
    if (circle !== item.circle) {
        next.circle = circle;
        changed = true;
    }

    const mentionsDisplay = redactMentionsLocations(item.mentionsDisplay, viewer);
    if (mentionsDisplay !== item.mentionsDisplay) {
        next.mentionsDisplay = mentionsDisplay;
        changed = true;
    }

    if (item.highlightedComment) {
        const hcAuthor = redactAuthorLocation(item.highlightedComment.author, viewer);
        const hcMentions = redactMentionsLocations(item.highlightedComment.mentionsDisplay, viewer);
        if (hcAuthor !== item.highlightedComment.author || hcMentions !== item.highlightedComment.mentionsDisplay) {
            next.highlightedComment = { ...item.highlightedComment, author: hcAuthor, mentionsDisplay: hcMentions };
            changed = true;
        }
    }

    if (item.sharedPostData) {
        const sharedPostData = redactContentLocations(item.sharedPostData, viewer);
        if (sharedPostData !== item.sharedPostData) {
            next.sharedPostData = sharedPostData;
            changed = true;
        }
    }

    return changed ? (next as T) : item;
}

// For callers outside this file that assemble a post themselves (the single post page).
export const redactPostLocationsForViewer = async <T extends LocationBearingContent>(
    post: T,
    viewerDid?: string,
): Promise<T> => {
    const viewerIsAdmin = await resolveViewerIsAdmin(viewerDid);
    return redactContentLocations(post, { viewerDid, viewerIsAdmin });
};

function redactContentListLocations<T extends LocationBearingContent>(items: T[], viewer: LocationViewerContext): T[] {
    return items.map((item) => redactContentLocations(item, viewer));
}

export const getFullPost = async (postId: string, userDid?: string): Promise<PostDisplay | null> => {
    const posts = (await Posts.aggregate([
        {
            $match: { _id: new ObjectId(postId) },
        },
        {
            $addFields: {
                feedIdObject: { $toObjectId: "$feedId" },
            },
        },
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
                from: "reactions",
                let: { postId: { $toString: "$_id" } },
                pipeline: [
                    {
                        $match: {
                            $expr: { $and: [{ $eq: ["$contentId", "$$postId"] }, { $eq: ["$userDid", userDid] }] },
                        },
                    },
                ],
                as: "userReaction",
            },
        },
        {
            $lookup: {
                from: "feeds",
                localField: "feedIdObject",
                foreignField: "_id",
                as: "feed",
            },
        },
        {
            $addFields: {
                feed: { $arrayElemAt: ["$feed", 0] },
                circleIdObject: { $toObjectId: { $arrayElemAt: ["$feed.circleId", 0] } },
            },
        },
        {
            $lookup: {
                from: "circles",
                localField: "circleIdObject",
                foreignField: "_id",
                as: "circle",
            },
        },
        {
            $addFields: {
                circle: { $arrayElemAt: ["$circle", 0] },
            },
        },
        {
            $lookup: {
                from: "circles",
                let: {
                    mentionIds: {
                        $ifNull: [{ $map: { input: "$mentions", as: "m", in: "$$m.id" } }, []],
                    },
                },
                pipeline: [
                    {
                        $match: {
                            $expr: { $in: [{ $toString: "$_id" }, "$$mentionIds"] },
                        },
                    },
                    {
                        $project: {
                            _id: { $toString: "$_id" },
                            did: 1,
                            name: 1,
                            picture: 1,
                            location: 1,
                            description: 1,
                            cover: 1,
                            handle: 1,
                            metadata: 1,
                        },
                    },
                ],
                as: "mentionsDetails",
            },
        },
        {
            $lookup: {
                from: "comments",
                let: { highlightedCommentId: { $toObjectId: "$highlightedCommentId" } },
                pipeline: [
                    { $match: { $expr: { $eq: ["$_id", "$$highlightedCommentId"] } } },
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
                            from: "reactions",
                            let: { commentId: { $toString: "$_id" } },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: {
                                            $and: [
                                                { $eq: ["$contentId", "$$commentId"] },
                                                { $eq: ["$userDid", userDid] },
                                            ],
                                        },
                                    },
                                },
                            ],
                            as: "userReaction",
                        },
                    },
                    {
                        $lookup: {
                            from: "circles",
                            let: {
                                mentionIds: {
                                    $ifNull: [{ $map: { input: "$mentions", as: "m", in: "$$m.id" } }, []],
                                },
                            },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: { $in: [{ $toString: "$_id" }, "$$mentionIds"] },
                                    },
                                },
                                {
                                    $project: {
                                        _id: { $toString: "$_id" },
                                        did: 1,
                                        name: 1,
                                        picture: 1,
                                        location: 1,
                                        description: 1,
                                        cover: 1,
                                        handle: 1,
                                        metadata: 1,
                                    },
                                },
                            ],
                            as: "mentionsDetails",
                        },
                    },
                ],
                as: "highlightedComment",
            },
        },
        { $unwind: { path: "$highlightedComment", preserveNullAndEmptyArrays: true } },
        {
            $project: {
                _id: { $toString: "$_id" },
                feedId: 1,
                title: 1,
                content: 1,
                createdAt: 1,
                reactions: 1,
                media: 1,
                createdBy: 1,
                comments: 1,
                location: 1,
                userGroups: 1,
                linkPreviewUrl: 1,
                linkPreviewTitle: 1,
                linkPreviewDescription: 1,
                linkPreviewImage: 1,
                internalPreviewUrl: 1,
                internalPreviewType: 1,
                internalPreviewId: 1,
                sharedPostId: 1,
                sdgs: 1,
                postType: 1,
                pinned: 1,
                isCrewMessage: 1,
                circleType: { $literal: "post" },
                highlightedCommentId: { $toString: "$highlightedCommentId" },
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
                    _id: { $toString: "$authorDetails._id" },
                    did: "$authorDetails.did",
                    name: "$authorDetails.name",
                    picture: "$authorDetails.picture",
                    location: "$authorDetails.location",
                    description: "$authorDetails.description",
                    images: "$authorDetails.images",
                    handle: "$authorDetails.handle",
                    isVerified: "$authorDetails.isVerified",
                    isMember: "$authorDetails.isMember",
                    metadata: "$authorDetails.metadata",
                },
                userReaction: { $arrayElemAt: ["$userReaction.reactionType", 0] },
                highlightedComment: {
                    $cond: {
                        if: { $ifNull: ["$highlightedComment", false] },
                        then: {
                            _id: { $toString: "$highlightedComment._id" },
                            postId: "$highlightedComment.postId",
                            parentCommentId: { $toString: "$highlightedComment.parentCommentId" },
                            content: "$highlightedComment.content",
                            createdBy: "$highlightedComment.createdBy",
                            createdAt: "$highlightedComment.createdAt",
                            reactions: "$highlightedComment.reactions",
                            replies: "$highlightedComment.replies",
                            isDeleted: "$highlightedComment.isDeleted",
                            mentions: "$highlightedComment.mentions",
                            mentionsDisplay: {
                                $map: {
                                    input: { $ifNull: ["$highlightedComment.mentions", []] },
                                    as: "mention",
                                    in: {
                                        type: "$$mention.type",
                                        id: "$$mention.id",
                                        circle: {
                                            $arrayElemAt: [
                                                {
                                                    $filter: {
                                                        input: { $ifNull: ["$highlightedComment.mentionsDetails", []] },
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
                                did: "$highlightedComment.authorDetails.did",
                                name: "$highlightedComment.authorDetails.name",
                                picture: "$highlightedComment.authorDetails.picture",
                                location: "$highlightedComment.authorDetails.location",
                                description: "$highlightedComment.authorDetails.description",
                                images: "$highlightedComment.authorDetails.images",
                                handle: "$highlightedComment.authorDetails.handle",
                                metadata: "$highlightedComment.authorDetails.metadata",
                            },
                            userReaction: { $arrayElemAt: ["$highlightedComment.userReaction.reactionType", 0] },
                        },
                        else: null,
                    },
                },
                feed: {
                    _id: { $toString: "$feed._id" },
                    name: "$feed.name",
                    handle: "$feed.handle",
                },
                circle: {
                    _id: { $toString: "$circle._id" },
                    name: "$circle.name",
                    handle: "$circle.handle",
                    picture: "$circle.picture",
                    accessRules: "$circle.accessRules",
                    userGroups: "$circle.userGroups",
                },
            },
        },
    ]).toArray()) as PostDisplay[];

    if (posts.length === 0) {
        return null;
    }

    await fetchAndAttachInternalPreviewData(posts, userDid);
    await fetchAndAttachSharedPostData(posts, userDid);

    const viewerIsAdmin = await resolveViewerIsAdmin(userDid);
    return redactContentLocations(posts[0], { viewerDid: userDid, viewerIsAdmin });
};

// Function to update the highlighted comment for a post
export const updateHighlightedComment = async (postId: string): Promise<void> => {
    const mostLikedComment = await Comments.find({ postId, parentCommentId: null })
        .sort({ "reactions.like": -1, createdAt: -1 })
        .limit(1)
        .toArray();

    const highlightedCommentId = mostLikedComment.length > 0 ? mostLikedComment[0]._id?.toString() : undefined;
    await Posts.updateOne({ _id: new ObjectId(postId) }, { $set: { highlightedCommentId } });
};

export const createComment = async (comment: Comment): Promise<Comment> => {
    try {
        const result = await Comments.insertOne(comment);
        const insertedComment = { ...comment, _id: result.insertedId.toString() };

        await Posts.updateOne(
            { _id: new ObjectId(comment.postId!) },
            { $inc: { comments: 1 }, $set: { lastActivityAt: new Date() } },
        );

        if (!comment.parentCommentId) {
            await updateHighlightedComment(comment.postId!);
        } else {
            // update replies
            await Comments.updateOne({ _id: new ObjectId(comment.parentCommentId) }, { $inc: { replies: 1 } });
        }

        console.log("💾 [DB] Comment created successfully:", {
            commentId: insertedComment._id,
            postId: comment.postId,
        });

        return insertedComment;
    } catch (error) {
        console.error("💾 [DB] Error creating comment:", error);
        throw error; // Important to propagate the error
    }
};

export const deleteComment = async (commentId: string): Promise<void> => {
    const comment = await Comments.findOne({ _id: new ObjectId(commentId) });
    if (!comment) return;

    if (comment.replies > 0) {
        // mark the comment as deleted and anonymize its data
        await Comments.updateOne(
            { _id: new ObjectId(commentId) },
            {
                $set: {
                    isDeleted: true,
                    content: "",
                    createdBy: "anonymous",
                    reactions: {},
                },
            },
        );
    } else {
        // If the comment has no replies, delete it
        await Comments.deleteOne({ _id: new ObjectId(commentId) });

        // Decrement comment count for the post
        await Posts.updateOne({ _id: new ObjectId(comment.postId!) }, { $inc: { comments: -1 } });

        if (comment.parentCommentId) {
            // Decrement comment count for the parent comment
            await Comments.updateOne({ _id: new ObjectId(comment.parentCommentId) }, { $inc: { replies: -1 } });
        }
    }

    if (!comment.parentCommentId) {
        await updateHighlightedComment(comment.postId!);
    }
};

// Function to get posts from multiple feeds
export async function getPostsFromMultipleFeeds(
    feedIds: string[],
    userDid: string | undefined,
    limit: number,
    skip: number,
    sort?: SortingOptions,
    sdgHandles?: string[],
    postType?: string,
): Promise<PostDisplay[]> {
    const matchStage: any = {
        feedId: { $in: feedIds },
    };

    if (postType) {
        matchStage.postType = postType;
    } else {
        matchStage.$or = [{ postType: { $eq: "post" } }, { postType: { $exists: false } }];
    }

    if (sdgHandles && sdgHandles.length > 0) {
        const sdgIds = sdgs.filter((s) => sdgHandles.includes(s.handle)).map((s) => s._id);
        if (sdgIds.length > 0) {
            matchStage.sdgs = { $in: sdgIds };
        }
    }

    // Get all posts from the specified feeds without user group filtering
    const posts = (await Posts.aggregate([
        {
            $match: matchStage,
        },

        // Convert `feedId` to ObjectId for lookup
        {
            $addFields: {
                feedIdObject: { $toObjectId: "$feedId" },
            },
        },

        // Lookup author details
        {
            $lookup: {
                from: "circles",
                localField: "createdBy",
                foreignField: "did",
                as: "authorDetails",
            },
        },
        { $unwind: "$authorDetails" },

        // Filter for verified or member authors, or if the post is by the current user
        {
            $match: {
                $or: [
                    { "authorDetails.isVerified": true },
                    { "authorDetails.isMember": true },
                    { "authorDetails.metadata.peerify.managedIdentity": true },
                    { createdBy: userDid },
                ],
            },
        },

        // Lookup user reactions
        {
            $lookup: {
                from: "reactions",
                let: { postId: { $toString: "$_id" } },
                pipeline: [
                    {
                        $match: {
                            $expr: { $and: [{ $eq: ["$contentId", "$$postId"] }, { $eq: ["$userDid", userDid] }] },
                        },
                    },
                ],
                as: "userReaction",
            },
        },

        // Lookup feed
        {
            $lookup: {
                from: "feeds",
                localField: "feedIdObject",
                foreignField: "_id",
                as: "feed",
            },
        },
        {
            $addFields: {
                feed: { $arrayElemAt: ["$feed", 0] },
                circleIdObject: { $toObjectId: { $arrayElemAt: ["$feed.circleId", 0] } },
            },
        },
        {
            $lookup: {
                from: "circles",
                localField: "circleIdObject",
                foreignField: "_id",
                as: "circle",
            },
        },
        {
            $addFields: {
                circle: { $arrayElemAt: ["$circle", 0] },
            },
        },

        //**********************************************************

        // **Adjusted Lookup for mentions in the post**
        {
            $lookup: {
                from: "circles",
                let: {
                    mentionIds: {
                        $ifNull: [{ $map: { input: "$mentions", as: "m", in: "$$m.id" } }, []],
                    },
                },
                pipeline: [
                    {
                        $match: {
                            $expr: { $in: [{ $toString: "$_id" }, "$$mentionIds"] },
                        },
                    },
                    {
                        $project: {
                            _id: { $toString: "$_id" },
                            did: 1,
                            name: 1,
                            picture: 1,
                            location: 1,
                            description: 1,
                            cover: 1,
                            handle: 1,
                            metadata: 1,
                        },
                    },
                ],
                as: "mentionsDetails",
            },
        },

        // Lookup for highlighted comment
        {
            $lookup: {
                from: "comments",
                let: { highlightedCommentId: { $toObjectId: "$highlightedCommentId" } },
                pipeline: [
                    { $match: { $expr: { $eq: ["$_id", "$$highlightedCommentId"] } } },
                    // Lookup for highlighted comment author
                    {
                        $lookup: {
                            from: "circles",
                            localField: "createdBy",
                            foreignField: "did",
                            as: "authorDetails",
                        },
                    },
                    { $unwind: "$authorDetails" },
                    // Lookup for reactions on highlighted comment
                    {
                        $lookup: {
                            from: "reactions",
                            let: { commentId: { $toString: "$_id" } },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: {
                                            $and: [
                                                { $eq: ["$contentId", "$$commentId"] },
                                                { $eq: ["$userDid", userDid] },
                                            ],
                                        },
                                    },
                                },
                            ],
                            as: "userReaction",
                        },
                    },
                    // **Adjusted Lookup for mentions in highlighted comment**
                    {
                        $lookup: {
                            from: "circles",
                            let: {
                                mentionIds: {
                                    $ifNull: [{ $map: { input: "$mentions", as: "m", in: "$$m.id" } }, []],
                                },
                            },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: { $in: [{ $toString: "$_id" }, "$$mentionIds"] },
                                    },
                                },
                                {
                                    $project: {
                                        _id: { $toString: "$_id" },
                                        did: 1,
                                        name: 1,
                                        picture: 1,
                                        location: 1,
                                        description: 1,
                                        cover: 1,
                                        handle: 1,
                                        metadata: 1,
                                    },
                                },
                            ],
                            as: "mentionsDetails",
                        },
                    },
                ],
                as: "highlightedComment",
            },
        },
        { $unwind: { path: "$highlightedComment", preserveNullAndEmptyArrays: true } },

        //**********************************************************

        // Sorting and pagination
        { $sort: sort === "activity" ? { lastActivityAt: -1 } : { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },

        // Final projection
        {
            $project: {
                _id: { $toString: "$_id" },
                feedId: 1,
                title: 1,
                content: 1,
                createdAt: 1,
                reactions: 1,
                media: 1,
                createdBy: 1,
                comments: 1,
                location: 1,
                userGroups: 1,
                linkPreviewUrl: 1,
                linkPreviewTitle: 1,
                linkPreviewDescription: 1,
                linkPreviewImage: 1,
                internalPreviewUrl: 1,
                internalPreviewType: 1,
                internalPreviewId: 1,
                sharedPostId: 1,
                sdgs: 1,
                circleType: { $literal: "post" },

                highlightedCommentId: { $toString: "$highlightedCommentId" },
                mentions: 1,
                // **Adjusted mapping of mentionsDisplay**
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
                    _id: { $toString: "$authorDetails._id" },
                    did: "$authorDetails.did",
                    name: "$authorDetails.name",
                    picture: "$authorDetails.picture",
                    location: "$authorDetails.location",
                    description: "$authorDetails.description",
                    images: "$authorDetails.images",
                    handle: "$authorDetails.handle",
                    isVerified: "$authorDetails.isVerified",
                    isMember: "$authorDetails.isMember",
                    metadata: "$authorDetails.metadata",
                },

                userReaction: { $arrayElemAt: ["$userReaction.reactionType", 0] },

                // Project highlightedComment
                highlightedComment: {
                    $cond: {
                        if: { $ifNull: ["$highlightedComment", false] },
                        then: {
                            _id: { $toString: "$highlightedComment._id" },
                            postId: "$highlightedComment.postId",
                            parentCommentId: { $toString: "$highlightedComment.parentCommentId" },
                            content: "$highlightedComment.content",
                            createdBy: "$highlightedComment.createdBy",
                            createdAt: "$highlightedComment.createdAt",
                            reactions: "$highlightedComment.reactions",
                            replies: "$highlightedComment.replies",
                            isDeleted: "$highlightedComment.isDeleted",
                            mentions: "$highlightedComment.mentions",
                            // **Adjusted mapping of mentionsDisplay in highlightedComment**
                            mentionsDisplay: {
                                $map: {
                                    input: { $ifNull: ["$highlightedComment.mentions", []] },
                                    as: "mention",
                                    in: {
                                        type: "$$mention.type",
                                        id: "$$mention.id",
                                        circle: {
                                            $arrayElemAt: [
                                                {
                                                    $filter: {
                                                        input: { $ifNull: ["$highlightedComment.mentionsDetails", []] },
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
                                did: "$highlightedComment.authorDetails.did",
                                name: "$highlightedComment.authorDetails.name",
                                picture: "$highlightedComment.authorDetails.picture",
                                location: "$highlightedComment.authorDetails.location",
                                description: "$highlightedComment.authorDetails.description",
                                images: "$highlightedComment.authorDetails.images",
                                handle: "$highlightedComment.authorDetails.handle",
                                metadata: "$highlightedComment.authorDetails.metadata",
                            },
                            userReaction: { $arrayElemAt: ["$highlightedComment.userReaction.reactionType", 0] },
                        },
                        else: null,
                    },
                },

                feed: {
                    _id: { $toString: "$feed._id" },
                    name: "$feed.name",
                    handle: "$feed.handle",
                },
                circle: {
                    _id: { $toString: "$circle._id" },
                    name: "$circle.name",
                    handle: "$circle.handle",
                    picture: "$circle.picture",
                    accessRules: "$circle.accessRules",
                    userGroups: "$circle.userGroups",
                },
            },
        },
    ]).toArray()) as PostDisplay[];

    // Post-processing to filter based on user groups
    if (userDid) {
        // Get user's memberships for each circle
        const userMemberships = new Map<string, string[]>();

        // Always add "everyone" as a group the user belongs to
        userMemberships.set("everyone", ["everyone"]);

        // Get the user's memberships from the Members collection
        const memberDocs = await Members.find({ userDid }).toArray();

        for (const memberDoc of memberDocs) {
            if (memberDoc.userGroups && memberDoc.userGroups.length > 0) {
                userMemberships.set(memberDoc.circleId, memberDoc.userGroups);
            }
        }

        // Filter posts based on user groups
        const filteredPosts = posts.filter((post) => {
            // If post has no user groups or empty user groups array, it's visible to everyone
            if (!post.userGroups || post.userGroups.length === 0) {
                return true;
            }

            // Get the circle ID for this post
            const circleId = post.circle?._id;
            if (!circleId) {
                return false; // No circle info, can't determine visibility
            }

            // Check if user has membership in this circle
            const userGroupsInCircle = userMemberships.get(circleId) || [];

            // Check if any of the post's user groups match the user's groups in this circle
            // Note: "everyone" in post.userGroups means it's visible to everyone
            return (
                post.userGroups.includes("everyone") ||
                post.userGroups.some((group) => userGroupsInCircle.includes(group))
            );
        });

        // --- Fetch Internal Preview Data (Post-Processing for logged-in user) ---
        await fetchAndAttachInternalPreviewData(filteredPosts, userDid);
        await fetchAndAttachSharedPostData(filteredPosts, userDid);
        // --- End Fetch Internal Preview Data ---

        const viewerIsAdmin = await resolveViewerIsAdmin(userDid);
        return redactContentListLocations(filteredPosts, { viewerDid: userDid, viewerIsAdmin });
    }

    // If no user is specified, only return posts with "everyone" user group
    const publicPosts = posts.filter(
        (post) => !post.userGroups || post.userGroups.length === 0 || post.userGroups.includes("everyone"),
    );

    // --- Fetch Internal Preview Data (Post-Processing) ---
    await fetchAndAttachInternalPreviewData(publicPosts, userDid);
    await fetchAndAttachSharedPostData(publicPosts, userDid);
    // --- End Fetch Internal Preview Data ---

    const viewerIsAdminForPublic = await resolveViewerIsAdmin(userDid);
    return redactContentListLocations(publicPosts, { viewerDid: userDid, viewerIsAdmin: viewerIsAdminForPublic });
}

export async function getPostsFromMultipleFeedsWithMetrics(
    feedIds: string[],
    userDid: string,
    limit: number,
    skip: number,
    sort?: SortingOptions,
    sdgHandles?: string[],
    postType?: string,
): Promise<PostDisplay[]> {
    let posts = await getPostsFromMultipleFeeds(feedIds, userDid, limit, skip, sort, sdgHandles, postType);

    let user: Circle | undefined = undefined;
    if (userDid) {
        user = await getUserByDid(userDid!);
    }
    const currentDate = new Date();

    // get metrics for each post
    for (const post of posts) {
        post.metrics = await getMetrics(user, post, currentDate, sort);
    }

    // sort posts by rank
    posts.sort((a, b) => (a.metrics?.rank ?? 0) - (b.metrics?.rank ?? 0));
    return posts;
}

export const getPostsWithMetrics = async (
    feedId: string,
    userDid?: string,
    limit: number = 10,
    offset: number = 0,
    sort?: SortingOptions,
    sdgHandles?: string[],
    postType?: string,
): Promise<PostDisplay[]> => {
    let posts = await getPosts(feedId, userDid, limit, offset, sdgHandles, postType);
    let user: Circle | undefined = undefined;
    if (userDid) {
        user = await getUserByDid(userDid!);
    }
    const currentDate = new Date();

    // get metrics for each post
    for (const post of posts) {
        post.metrics = await getMetrics(user, post, currentDate, sort);
    }

    // sort posts by rank
    posts.sort((a, b) => (a.metrics?.rank ?? 0) - (b.metrics?.rank ?? 0));
    return posts;
};

export const getPosts = async (
    feedId: string,
    userDid?: string,
    limit: number = 10,
    offset: number = 0,
    sdgHandles?: string[],
    postType?: string,
): Promise<PostDisplay[]> => {
    const safeLimit = Math.max(1, limit);
    const safeOffset = Math.max(0, offset);

    const matchStage: any = {
        feedId: feedId,
    };

    if (postType) {
        matchStage.postType = postType;
    } else {
        matchStage.$or = [{ postType: { $eq: "post" } }, { postType: { $exists: false } }];
    }

    if (sdgHandles && sdgHandles.length > 0) {
        const sdgIds = sdgs.filter((s) => sdgHandles.includes(s.handle)).map((s) => s._id);
        if (sdgIds.length > 0) {
            matchStage.sdgs = { $in: sdgIds };
        }
    }

    // Get posts without user group filtering initially
    const posts = (await Posts.aggregate([
        {
            $match: matchStage,
        },
        // Lookup for author details
        {
            $lookup: {
                from: "circles",
                localField: "createdBy",
                foreignField: "did",
                as: "authorDetails",
            },
        },
        { $unwind: "$authorDetails" },

        // Filter for verified or member authors, or if the post is by the current user
        {
            $match: {
                $or: [
                    { "authorDetails.isVerified": true },
                    { "authorDetails.isMember": true },
                    { "authorDetails.metadata.peerify.managedIdentity": true },
                    { createdBy: userDid },
                ],
            },
        },

        // Lookup for reactions on the post
        {
            $lookup: {
                from: "reactions",
                let: { postId: { $toString: "$_id" } },
                pipeline: [
                    {
                        $match: {
                            $expr: { $and: [{ $eq: ["$contentId", "$$postId"] }, { $eq: ["$userDid", userDid] }] },
                        },
                    },
                ],
                as: "userReaction",
            },
        },

        // **Adjusted Lookup for mentions in the post**
        {
            $lookup: {
                from: "circles",
                let: {
                    mentionIds: {
                        $ifNull: [{ $map: { input: "$mentions", as: "m", in: "$$m.id" } }, []],
                    },
                },
                pipeline: [
                    {
                        $match: {
                            $expr: { $in: [{ $toString: "$_id" }, "$$mentionIds"] },
                        },
                    },
                    {
                        $project: {
                            _id: { $toString: "$_id" },
                            did: 1,
                            name: 1,
                            picture: 1,
                            location: 1,
                            description: 1,
                            cover: 1,
                            handle: 1,
                            metadata: 1,
                        },
                    },
                ],
                as: "mentionsDetails",
            },
        },

        // Lookup for highlighted comment
        {
            $lookup: {
                from: "comments",
                let: { highlightedCommentId: { $toObjectId: "$highlightedCommentId" } },
                pipeline: [
                    { $match: { $expr: { $eq: ["$_id", "$$highlightedCommentId"] } } },
                    // Lookup for highlighted comment author
                    {
                        $lookup: {
                            from: "circles",
                            localField: "createdBy",
                            foreignField: "did",
                            as: "authorDetails",
                        },
                    },
                    { $unwind: "$authorDetails" },
                    // Lookup for reactions on highlighted comment
                    {
                        $lookup: {
                            from: "reactions",
                            let: { commentId: { $toString: "$_id" } },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: {
                                            $and: [
                                                { $eq: ["$contentId", "$$commentId"] },
                                                { $eq: ["$userDid", userDid] },
                                            ],
                                        },
                                    },
                                },
                            ],
                            as: "userReaction",
                        },
                    },
                    // **Adjusted Lookup for mentions in highlighted comment**
                    {
                        $lookup: {
                            from: "circles",
                            let: {
                                mentionIds: {
                                    $ifNull: [{ $map: { input: "$mentions", as: "m", in: "$$m.id" } }, []],
                                },
                            },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: { $in: [{ $toString: "$_id" }, "$$mentionIds"] },
                                    },
                                },
                                {
                                    $project: {
                                        _id: { $toString: "$_id" },
                                        did: 1,
                                        name: 1,
                                        picture: 1,
                                        location: 1,
                                        description: 1,
                                        cover: 1,
                                        handle: 1,
                                        metadata: 1,
                                    },
                                },
                            ],
                            as: "mentionsDetails",
                        },
                    },
                ],
                as: "highlightedComment",
            },
        },
        { $unwind: { path: "$highlightedComment", preserveNullAndEmptyArrays: true } },

        // Sorting and pagination
        { $sort: { createdAt: -1 } },
        { $skip: safeOffset },
        { $limit: safeLimit },

        // Final projection
        {
            $project: {
                _id: { $toString: "$_id" },
                feedId: 1,
                title: 1,
                content: 1,
                createdAt: 1,
                reactions: 1,
                media: 1,
                createdBy: 1,
                comments: 1,
                location: 1,
                userGroups: 1,
                linkPreviewUrl: 1,
                linkPreviewTitle: 1,
                linkPreviewDescription: 1,
                linkPreviewImage: 1,
                internalPreviewUrl: 1,
                internalPreviewType: 1,
                internalPreviewId: 1,
                sharedPostId: 1,
                sdgs: 1,
                postType: 1,
                pinned: 1,
                isCrewMessage: 1,
                circleType: { $literal: "post" },
                highlightedCommentId: { $toString: "$highlightedCommentId" },
                mentions: 1,
                // **Adjusted mapping of mentionsDisplay**
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
                    _id: { $toString: "$authorDetails._id" },
                    did: "$authorDetails.did",
                    name: "$authorDetails.name",
                    picture: "$authorDetails.picture",
                    location: "$authorDetails.location",
                    description: "$authorDetails.description",
                    images: "$authorDetails.images",
                    handle: "$authorDetails.handle",
                    isVerified: "$authorDetails.isVerified",
                    isMember: "$authorDetails.isMember",
                    metadata: "$authorDetails.metadata",
                },
                userReaction: { $arrayElemAt: ["$userReaction.reactionType", 0] },

                // Project highlightedComment
                highlightedComment: {
                    $cond: {
                        if: { $ifNull: ["$highlightedComment", false] },
                        then: {
                            _id: { $toString: "$highlightedComment._id" },
                            postId: "$highlightedComment.postId",
                            parentCommentId: { $toString: "$highlightedComment.parentCommentId" },
                            content: "$highlightedComment.content",
                            createdBy: "$highlightedComment.createdBy",
                            createdAt: "$highlightedComment.createdAt",
                            reactions: "$highlightedComment.reactions",
                            replies: "$highlightedComment.replies",
                            isDeleted: "$highlightedComment.isDeleted",
                            mentions: "$highlightedComment.mentions",
                            // **Adjusted mapping of mentionsDisplay in highlightedComment**
                            mentionsDisplay: {
                                $map: {
                                    input: { $ifNull: ["$highlightedComment.mentions", []] },
                                    as: "mention",
                                    in: {
                                        type: "$$mention.type",
                                        id: "$$mention.id",
                                        circle: {
                                            $arrayElemAt: [
                                                {
                                                    $filter: {
                                                        input: { $ifNull: ["$highlightedComment.mentionsDetails", []] },
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
                                did: "$highlightedComment.authorDetails.did",
                                name: "$highlightedComment.authorDetails.name",
                                picture: "$highlightedComment.authorDetails.picture",
                                location: "$highlightedComment.authorDetails.location",
                                description: "$highlightedComment.authorDetails.description",
                                images: "$highlightedComment.authorDetails.images",
                                handle: "$highlightedComment.authorDetails.handle",
                                metadata: "$highlightedComment.authorDetails.metadata",
                            },
                            userReaction: { $arrayElemAt: ["$highlightedComment.userReaction.reactionType", 0] },
                        },
                        else: null,
                    },
                },
            },
        },
    ]).toArray()) as PostDisplay[];

    // Post-processing to filter based on user groups
    if (userDid) {
        // Get user's memberships for each circle
        const userMemberships = new Map<string, string[]>();

        // Always add "everyone" as a group the user belongs to
        userMemberships.set("everyone", ["everyone"]);

        // Get the user's memberships from the Members collection
        const memberDocs = await Members.find({ userDid }).toArray();

        for (const memberDoc of memberDocs) {
            if (memberDoc.userGroups && memberDoc.userGroups.length > 0) {
                userMemberships.set(memberDoc.circleId, memberDoc.userGroups);
            }
        }

        // For single feed posts, we need to get the circle ID from the feed
        const feed = await getFeed(feedId);
        const circleId = feed?.circleId;

        // Filter posts based on user groups
        const filteredPosts = posts.filter((post) => {
            // If post has no user groups or empty user groups array, it's visible to everyone
            if (!post.userGroups || post.userGroups.length === 0) {
                return true;
            }

            if (!circleId) {
                return false; // No circle info, can't determine visibility
            }

            // Check if user has membership in this circle
            const userGroupsInCircle = userMemberships.get(circleId) || [];

            // Check if any of the post's user groups match the user's groups in this circle
            // Note: "everyone" in post.userGroups means it's visible to everyone
            return (
                post.userGroups.includes("everyone") ||
                post.userGroups.some((group) => userGroupsInCircle.includes(group))
            );
        });

        // --- Fetch Internal Preview Data (Post-Processing for logged-in user) ---
        await fetchAndAttachInternalPreviewData(filteredPosts, userDid);
        await fetchAndAttachSharedPostData(filteredPosts, userDid);
        // --- End Fetch Internal Preview Data ---

        const viewerIsAdmin = await resolveViewerIsAdmin(userDid);
        return redactContentListLocations(filteredPosts, { viewerDid: userDid, viewerIsAdmin });
    }

    // If no user is specified, only return posts with "everyone" user group
    const publicPostsForFeed = posts.filter(
        (post) => !post.userGroups || post.userGroups.length === 0 || post.userGroups.includes("everyone"),
    );

    // --- Fetch Internal Preview Data (Post-Processing) ---
    await fetchAndAttachInternalPreviewData(publicPostsForFeed, userDid); // Fetch for the correct list
    await fetchAndAttachSharedPostData(publicPostsForFeed, userDid);
    // --- End Fetch Internal Preview Data ---

    const viewerIsAdminForPublic = await resolveViewerIsAdmin(userDid);
    return redactContentListLocations(publicPostsForFeed, { viewerDid: userDid, viewerIsAdmin: viewerIsAdminForPublic });
};

// Internal previews: a post can point at another item via internalPreviewType/internalPreviewId, and
// the resolved item is embedded in the post for every viewer of that post — anonymous visitors
// included, and the pointer itself is author-supplied (createPostAction stores whatever the
// composer sends). So each target is gated against the VIEWER here, using the same rules as the
// target's own page, and only the fields InternalLinkPreview / post-grid / SharedPostPreview
// actually render are returned — never locations, invitations, participants, votes or beneficiary
// data. A target the viewer may not see gets null and renders as a plain link.

type PreviewData = NonNullable<PostDisplay["internalPreviewData"]>;

// First image only (the cards show images[0]), reduced to its URL.
const toPreviewImages = (images: unknown): Media[] | undefined => {
    const first = Array.isArray(images) ? images[0] : undefined;
    const url = first?.fileInfo?.url;
    return url ? [{ name: first.name, type: first.type, fileInfo: { url } } as Media] : undefined;
};

const createPreviewAccessChecker = (viewerDid: string | undefined) => {
    const featureCache = new Map<string, Promise<boolean>>();
    const memberGroupsCache = new Map<string, Promise<string[] | null>>();

    const canUseFeature = (circleId: string | undefined, feature: Feature): Promise<boolean> => {
        if (!circleId || !ObjectId.isValid(circleId)) return Promise.resolve(false);
        const key = `${circleId}:${feature.module}:${feature.handle}`;
        if (!featureCache.has(key)) {
            featureCache.set(
                key,
                isAuthorized(viewerDid, circleId, feature).catch(() => false),
            );
        }
        return featureCache.get(key)!;
    };

    // null = not a member of that circle (or logged out).
    const getMemberGroups = (circleId: string): Promise<string[] | null> => {
        if (!viewerDid) return Promise.resolve(null);
        if (!memberGroupsCache.has(circleId)) {
            memberGroupsCache.set(
                circleId,
                Members.findOne({ userDid: viewerDid, circleId }, { projection: { _id: 0, userGroups: 1 } }).then(
                    (membership) => (membership ? (membership.userGroups ?? []) : null),
                ),
            );
        }
        return memberGroupsCache.get(circleId)!;
    };

    // Same rule as canUserViewPost's final check: no groups / "everyone" is open, otherwise the
    // viewer needs a matching group in the item's own circle.
    const matchesUserGroups = async (circleId: string, userGroups?: string[]): Promise<boolean> => {
        if (!userGroups || userGroups.length === 0 || userGroups.includes("everyone")) return true;
        const memberGroups = await getMemberGroups(circleId);
        return !!memberGroups && userGroups.some((group) => memberGroups.includes(group));
    };

    return { canUseFeature, getMemberGroups, matchesUserGroups };
};

const toObjectIds = (ids: string[]): ObjectId[] =>
    ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

async function fetchAndAttachInternalPreviewData(posts: PostDisplay[], viewerDid: string | undefined): Promise<void> {
    const postsWithInternalLinks = posts.filter((p) => p.internalPreviewType && p.internalPreviewId);
    if (postsWithInternalLinks.length === 0) return;

    const access = createPreviewAccessChecker(viewerDid);
    const previewDataMap = new Map<string, PreviewData>();

    // Group IDs by type
    const idsByType = postsWithInternalLinks.reduce(
        (acc, post) => {
            const type = post.internalPreviewType!;
            const id = post.internalPreviewId!;
            if (!acc[type]) acc[type] = new Set();
            acc[type].add(id);
            return acc;
        },
        {} as Record<string, Set<string>>,
    );

    const resolvers: Record<string, (ids: string[]) => Promise<void>> = {
        // Circle previews are keyed by handle. Identity fields only; unpublished, non-searchable
        // (personal profiles are opt-in) or pending/rejected accounts are shown only to the
        // circle itself and its members.
        circle: async (handles) => {
            const circles = await Circles.find(
                { handle: { $in: handles } },
                { projection: { ...IDENTITY_CIRCLE_PROJECTION, publishStatus: 1, accountStatus: 1 } },
            ).toArray();
            await Promise.all(
                circles.map(async (c) => {
                    const { publishStatus, accountStatus, ...identity } = c as any;
                    const circleId = c._id.toString();
                    const isPublished = publishStatus === "published" || publishStatus === undefined;
                    const isDiscoverable = c.circleType === "user" ? c.searchable === true : c.searchable !== false;
                    const isActiveAccount = accountStatus !== "pending_verification" && accountStatus !== "rejected";
                    const visible =
                        (isPublished && isDiscoverable && isActiveAccount) ||
                        (!!viewerDid && (c.did === viewerDid || (await access.getMemberGroups(circleId)) !== null));
                    if (!visible) return;
                    previewDataMap.set(`circle-${c.handle}`, { ...identity, _id: circleId } as Circle);
                }),
            );
        },
        post: async (ids) => {
            const targets = (await Posts.find(
                { _id: { $in: toObjectIds(ids) } },
                { projection: { _id: 1, content: 1, createdBy: 1, feedId: 1, postType: 1, userGroups: 1 } },
            ).toArray()) as unknown as Post[];
            const visible = (
                await Promise.all(
                    targets.map(async (p) => ((await canUserViewPost(p, viewerDid).catch(() => false)) ? p : null)),
                )
            ).filter((p): p is Post => p !== null);
            if (visible.length === 0) return;

            const authors = await Circles.find(
                { did: { $in: visible.map((p) => p.createdBy) } },
                { projection: IDENTITY_CIRCLE_PROJECTION },
            ).toArray();
            const authorMap = new Map(authors.map((a) => [a.did, { ...a, _id: a._id.toString() } as Circle]));
            visible.forEach((p) => {
                const postId = p._id!.toString();
                previewDataMap.set(`post-${postId}`, {
                    _id: postId,
                    content: p.content,
                    circleType: "post",
                    author: authorMap.get(p.createdBy),
                } as unknown as PostDisplay);
            });
        },
        proposal: async (ids) => {
            const proposals = await Proposals.find(
                { _id: { $in: toObjectIds(ids) } },
                { projection: { _id: 1, circleId: 1, userGroups: 1, name: 1, stage: 1, outcome: 1 } },
            ).toArray();
            await Promise.all(
                proposals.map(async (p) => {
                    if (!(await access.canUseFeature(p.circleId, features.proposals.view))) return;
                    if (!(await access.matchesUserGroups(p.circleId, p.userGroups))) return;
                    const proposalId = p._id.toString();
                    previewDataMap.set(`proposal-${proposalId}`, {
                        _id: proposalId,
                        name: p.name,
                        stage: p.stage,
                        outcome: p.outcome,
                    } as unknown as ProposalDisplay);
                }),
            );
        },
        issue: async (ids) => {
            const issues = await Issues.find(
                { _id: { $in: toObjectIds(ids) } },
                { projection: { _id: 1, circleId: 1, userGroups: 1, title: 1, stage: 1 } },
            ).toArray();
            await Promise.all(
                issues.map(async (i) => {
                    if (!(await access.canUseFeature(i.circleId, features.issues.view))) return;
                    if (!(await access.matchesUserGroups(i.circleId, i.userGroups))) return;
                    const issueId = i._id.toString();
                    previewDataMap.set(`issue-${issueId}`, {
                        _id: issueId,
                        title: i.title,
                        stage: i.stage,
                    } as unknown as IssueDisplay);
                }),
            );
        },
        task: async (ids) => {
            const tasks = await Tasks.find(
                { _id: { $in: toObjectIds(ids) } },
                { projection: { _id: 1, circleId: 1, userGroups: 1, title: 1, stage: 1, taskType: 1, images: 1 } },
            ).toArray();
            await Promise.all(
                tasks.map(async (t) => {
                    if (!(await access.canUseFeature(t.circleId, features.tasks.view))) return;
                    if (!(await access.matchesUserGroups(t.circleId, t.userGroups))) return;
                    const taskId = t._id.toString();
                    previewDataMap.set(`task-${taskId}`, {
                        _id: taskId,
                        title: t.title,
                        stage: t.stage,
                        taskType: t.taskType,
                        images: toPreviewImages(t.images),
                    } as unknown as TaskDisplay);
                }),
            );
        },
        // Mirrors getPublicEventByIdForCircle's gate (not private, past draft/review), plus events.view
        // on the event's circle and the event's own userGroups. Cancelled events stay previewable so
        // an existing announcement still shows its card.
        event: async (ids) => {
            const events = await Events.find(
                { _id: { $in: toObjectIds(ids) } },
                {
                    projection: {
                        _id: 1,
                        circleId: 1,
                        userGroups: 1,
                        visibility: 1,
                        stage: 1,
                        title: 1,
                        startAt: 1,
                        endAt: 1,
                        images: 1,
                    },
                },
            ).toArray();
            await Promise.all(
                events.map(async (event) => {
                    if (event.visibility === "private") return;
                    if (event.stage !== "open" && event.stage !== "cancelled") return;
                    if (!(await access.canUseFeature(event.circleId, features.events.view))) return;
                    if (!(await access.matchesUserGroups(event.circleId, event.userGroups))) return;
                    const eventId = event._id.toString();
                    previewDataMap.set(`event-${eventId}`, {
                        _id: eventId,
                        title: event.title,
                        startAt: event.startAt,
                        endAt: event.endAt,
                        images: toPreviewImages(event.images),
                    } as unknown as EventDisplay);
                }),
            );
        },
        // Same gate as getFundingAskById: funding enabled + member/superadmin of the ask's circle,
        // and drafts only for their creator or a superadmin.
        funding: async (ids) => {
            const asks = await Promise.all(ids.map((id) => getFundingAskDocumentById(id)));
            await Promise.all(
                asks.map(async (ask) => {
                    if (!ask?._id || !ask.circleId || !ObjectId.isValid(ask.circleId)) return;
                    const circle = (await Circles.findOne(
                        { _id: new ObjectId(ask.circleId) },
                        { projection: { _id: 1, circleType: 1, enabledModules: 1 } },
                    )) as Circle | null;
                    if (!circle) return;
                    const permissions = await getFundingCirclePermissions(
                        { ...circle, _id: circle._id!.toString() },
                        viewerDid,
                    );
                    if (!permissions.canView) return;
                    if (!isFundingAskVisibleToViewer({ ask, viewerDid, isSuperAdmin: permissions.isSuperAdmin })) {
                        return;
                    }
                    const askId = ask._id.toString();
                    previewDataMap.set(`funding-${askId}`, {
                        _id: askId,
                        title: ask.title,
                        shortStory: ask.shortStory,
                        status: ask.status,
                        trustBadgeType: ask.trustBadgeType,
                        coverImage: ask.coverImage?.url ? { url: ask.coverImage.url } : undefined,
                        // getFundingRequestSummaryLine only needs each item's status/currency/price.
                        items: (ask.items ?? []).map((item) => ({
                            status: item.status,
                            currency: item.currency,
                            price: item.price,
                        })),
                    } as unknown as FundingAskDisplay);
                }),
            );
        },
    };

    await Promise.all(
        Object.entries(idsByType).map(async ([type, idsSet]) => {
            const resolve = resolvers[type];
            if (!resolve) return;
            try {
                await resolve(Array.from(idsSet));
            } catch (error) {
                console.error(`Error fetching internal preview data for type ${type}:`, error);
            }
        }),
    );

    // Attach fetched data to posts
    postsWithInternalLinks.forEach((post) => {
        const key = `${post.internalPreviewType}-${post.internalPreviewId}`;
        post.internalPreviewData = previewDataMap.get(key) || null; // Set to null if not found or not visible
    });
}

async function fetchAndAttachSharedPostData(posts: PostDisplay[], userDid?: string): Promise<void> {
    const postsWithShares = posts.filter((post) => post.sharedPostId);
    if (postsWithShares.length === 0) {
        return;
    }

    const sharedPosts = await Promise.all(
        postsWithShares.map(async (post) => ({
            ownerPostId: post._id,
            sharedPost: await getShareablePostPreview(post.sharedPostId!, userDid),
        })),
    );

    const sharedPostMap = new Map(sharedPosts.map((entry) => [entry.ownerPostId, entry.sharedPost]));
    postsWithShares.forEach((post) => {
        post.sharedPostData = sharedPostMap.get(post._id) ?? null;
    });
}

export const updatePost = async (post: Partial<Post>): Promise<void> => {
    const { _id, ...postWithoutId } = post;
    let result = await Posts.updateOne({ _id: new ObjectId(_id) }, { $set: postWithoutId });
    if (result.matchedCount === 0) {
        throw new Error("Post not found");
    }
    // update post embedding
    let p = await getPost(_id);
    if (p) {
        let author = await getUserByDid(p.createdBy);
        try {
            const { sdgs: sdgIds, ...restOfP } = p;
            const populatedSdgs = sdgIds ? sdgs.filter((s) => sdgIds.includes(s._id)) : [];
            const postForVdb = { ...restOfP, sdgs: populatedSdgs, author: author!, circleType: "post" as const };
            await upsertVbdPosts([postForVdb as PostDisplay]);
        } catch (e) {
            console.error("Failed to upsert post embedding", e);
        }
    }
};

export const getAllComments = async (postId: string, userDid: string | undefined): Promise<CommentDisplay[]> => {
    const comments = (await Comments.aggregate([
        { $match: { postId: postId } },

        // Lookup for author details
        {
            $lookup: {
                from: "circles",
                localField: "createdBy",
                foreignField: "did",
                as: "authorDetails",
            },
        },
        { $unwind: "$authorDetails" },

        // Lookup for reactions on the comment
        {
            $lookup: {
                from: "reactions",
                let: { commentId: { $toString: "$_id" } },
                pipeline: [
                    {
                        $match: {
                            $expr: { $and: [{ $eq: ["$contentId", "$$commentId"] }, { $eq: ["$userDid", userDid] }] },
                        },
                    },
                ],
                as: "userReaction",
            },
        },

        // **Adjusted Lookup for mentions in the comment**
        {
            $lookup: {
                from: "circles",
                let: {
                    mentionIds: {
                        $ifNull: [{ $map: { input: "$mentions", as: "m", in: "$$m.id" } }, []],
                    },
                },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $in: [{ $toString: "$_id" }, "$$mentionIds"],
                            },
                        },
                    },
                    {
                        $project: {
                            _id: { $toString: "$_id" },
                            did: 1,
                            name: 1,
                            picture: 1,
                            location: 1,
                            description: 1,
                            cover: 1,
                            handle: 1,
                            metadata: 1,
                        },
                    },
                ],
                as: "mentionsDetails",
            },
        },

        // Final projection
        {
            $project: {
                _id: { $toString: "$_id" },
                postId: 1,
                parentCommentId: 1,
                content: 1,
                createdBy: 1,
                createdAt: 1,
                reactions: 1,
                replies: 1,
                isDeleted: 1,
                mentions: 1,
                // **Adjusted mapping of mentionsDisplay**
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
                                            cond: {
                                                $eq: ["$$circle._id", "$$mention.id"],
                                            },
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
                    location: "$authorDetails.location",
                    description: "$authorDetails.description",
                    images: "$authorDetails.images",
                    handle: "$authorDetails.handle",
                    metadata: "$authorDetails.metadata",
                },
                userReaction: { $arrayElemAt: ["$userReaction.reactionType", 0] },
            },
        },
    ]).toArray()) as CommentDisplay[];

    // Compute rootParentId for each comment
    const commentMap = new Map<string, CommentDisplay>();
    comments.forEach((comment) => {
        commentMap.set(comment._id!, comment);
    });

    comments.forEach((comment) => {
        let rootParentId: string | undefined = undefined;
        let currentComment = comment;

        // If the comment is a top-level comment, rootParentId remains undefined
        if (!currentComment.parentCommentId) {
            comment.rootParentId = undefined;
        } else {
            // Walk up the parent chain to find the top-level comment
            while (currentComment.parentCommentId) {
                const parentComment = commentMap.get(currentComment.parentCommentId);
                if (parentComment) {
                    rootParentId = parentComment._id!;
                    currentComment = parentComment;
                } else {
                    // Parent comment not found, break the loop
                    break;
                }
            }
            comment.rootParentId = rootParentId;
        }
    });

    const viewerIsAdmin = await resolveViewerIsAdmin(userDid);
    return redactContentListLocations(comments, { viewerDid: userDid, viewerIsAdmin });
};

export const getPostsForEmbedding = async (): Promise<PostDisplay[]> => {
    const posts = await Posts.aggregate([
        // Lookup for author details
        {
            $lookup: {
                from: "circles",
                localField: "createdBy",
                foreignField: "did",
                as: "authorDetails",
            },
        },
        { $unwind: "$authorDetails" },

        // Final projection to select only necessary fields for embedding
        {
            $project: {
                _id: { $toString: "$_id" },
                content: 1,
                createdAt: 1,
                createdBy: 1,
                location: 1,
                // Include author details
                author: {
                    name: "$authorDetails.name",
                    handle: "$authorDetails.handle",
                },
            },
        },
    ]).toArray();

    return posts as PostDisplay[];
};

export const getComment = async (commentId: string): Promise<Comment | null> => {
    let comment = (await Comments.findOne({ _id: new ObjectId(commentId) })) as Comment;
    if (comment) {
        comment._id = comment._id?.toString();
    }
    return comment;
};

export const updateComment = async (
    commentId: string,
    updatedContent: string,
    updatedMentions: Mention[],
): Promise<void> => {
    const result = await Comments.updateOne(
        { _id: new ObjectId(commentId) },
        {
            $set: {
                content: updatedContent,
                mentions: updatedMentions,
                editedAt: new Date(), // Set the edited date
            },
        },
    );

    if (result.matchedCount === 0) {
        throw new Error("Comment not found");
    }
};

export const likeContent = async (
    contentId: string,
    contentType: "post" | "comment",
    userDid: string,
    reactionType: string = "like",
): Promise<void> => {
    // make sure like doesn't already exist
    const existingReaction = await Reactions.findOne({
        contentId,
        contentType,
        userDid,
        reactionType,
    });

    if (existingReaction) {
        return;
    }

    await Reactions.insertOne({
        contentId,
        contentType,
        userDid,
        reactionType,
        count: 1,
        createdAt: new Date(),
    });

    const collection = contentType === "post" ? Posts : Comments;
    await collection.updateOne({ _id: new ObjectId(contentId) }, { $inc: { [`reactions.${reactionType}`]: 1 } });

    if (contentType === "comment") {
        const comment = await Comments.findOne({ _id: new ObjectId(contentId) });
        if (comment && !comment.parentCommentId) {
            await updateHighlightedComment(comment.postId!);
        }
    }
};

export const unlikeContent = async (
    contentId: string,
    contentType: "post" | "comment",
    userDid: string,
    reactionType: string = "like",
): Promise<void> => {
    await Reactions.deleteOne({
        contentId,
        contentType,
        userDid,
        reactionType,
    });

    const collection = contentType === "post" ? Posts : Comments;
    await collection.updateOne({ _id: new ObjectId(contentId) }, { $inc: { [`reactions.${reactionType}`]: -1 } });

    if (contentType === "comment") {
        const comment = await Comments.findOne({ _id: new ObjectId(contentId) });
        if (comment && !comment.parentCommentId) {
            await updateHighlightedComment(comment.postId!);
        }
    }
};

export const getReactions = async (
    contentId: string,
    contentType: "post" | "comment",
    viewerDid?: string,
): Promise<Circle[]> => {
    const reactions = await Reactions.find({ contentId, contentType }).limit(20).toArray();
    const userDids = reactions.map((r) => r.userDid);
    const users = await Circles.find({ did: { $in: userDids } }, { projection: SAFE_CIRCLE_PROJECTION }).toArray();
    const viewerIsAdmin = await resolveViewerIsAdmin(viewerDid);
    return users.map((user) => ({
        did: user.did,
        name: user.name,
        picture: user.picture,
        // City level at most, like every other profile location in a post payload (see
        // toFeedProfileLocation). user is already a full Circle here (SAFE_CIRCLE_PROJECTION).
        location: toFeedProfileLocation(user as Circle, { viewerDid, viewerIsAdmin }),
        description: user.description,
        images: user.images,
        handle: user.handle,
    })) as Circle[];
};

export const checkIfLiked = async (
    contentId: string,
    contentType: "post" | "comment",
    userDid: string,
): Promise<boolean> => {
    const reaction = await Reactions.findOne({
        contentId,
        contentType,
        userDid,
        reactionType: "like",
    });
    return !!reaction;
};
