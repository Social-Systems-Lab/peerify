// events/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { Feeds, Events, EventInvitations, EventRsvps } from "@/lib/data/db";
import { createDefaultFeed, createPost, getFeedByHandle, updatePost } from "@/lib/data/feed";
import {
    Circle,
    Media,
    mediaSchema,
    locationSchema,
    didSchema,
    Event as EventModel,
    EventDisplay,
    EventStage,
    CircleType,
    eventVisibilitySchema,
    peerifyEventMetadataSchema,
    Post,
    TaskDisplay,
    postSchema,
    Location,
} from "@/models/models";
import {
    getCircleByHandle,
    ensureModuleIsEnabledOnCircle,
    getCirclesBySearchQuery,
    getCircleById,
    getCirclesByIds,
    isCirclePublished,
} from "@/lib/data/circle";
import { getAuthenticatedUserDid, isAuthorized, isBlockedOnlyByVerification } from "@/lib/auth/auth";
import { getUserByDid, getUserPrivate, getPrivateUserByDid, updateUser } from "@/lib/data/user";
import { saveFile, deleteFile, FileInfo as StorageFileInfo, isFile } from "@/lib/data/storage";
import { features } from "@/lib/data/constants";
import { normalizeEventTags, type EventTagsValue } from "@/lib/peerify/event-tags";
import {
    capacityBelowConfirmedMessage,
    confirmedFitWithinFilter,
    getPlacesTakenOutside,
    parsePlacesTakenOutside,
    withPlacesTakenOutside,
    countConfirmedGuests,
    parseEventCapacity,
} from "@/lib/events/guest-capacity";

// Data layer
import {
    getEventsByCircleId,
    getEventById,
    getPublicEventByIdForCircle,
    getPublicEventsByCircleId,
    createEvent as createEventDb,
    updateEvent as updateEventDb,
    deleteEvent as deleteEventDb,
    changeEventStage as changeEventStageDb,
    applyEventHostChange,
    canAnonymousViewCircleEvents,
    canViewerOpenCircle,
    shapeEventForViewer,
    shapeEventsForViewer,
    canManageEvent,
    getEventRsvpRefusal,
    RSVP_EVENT_NOT_FOUND,
    canSeeEventGuests,
} from "@/lib/data/event";
import { getCirclesByDids } from "@/lib/data/circle";
import { upsertRsvp, cancelRsvp, listEventGuests, type EventGuest } from "@/lib/data/eventRsvp";
import {
    CONFIRMED_GUEST_CANT_CHANGE,
    confirmEventGuest,
    getConfirmedGuestDids,
    isConfirmedGuest,
    ONLY_CONFIRMED_GUESTS_MESSAGE,
    openConversationWithOrganisers,
    unconfirmEventGuest,
} from "@/lib/data/event-guests";
import {
    notifyEventSubmittedForReview,
    notifyEventApproved,
    notifyEventStatusChanged,
    notifyAddedAsEventArtist,
    notifyEventHostChangeRequested,
    notifyEventHostChangeDecided,
} from "@/lib/data/eventNotifications";
import {
    getPendingEventHostChangeRequestForEvent,
    getPendingEventHostChangeRequestsForCircle,
    getEventHostChangeRequest,
    createPendingEventHostChangeRequest,
    updateEventHostChangeRequestStatus,
} from "@/lib/data/eventHostChangeRequests";
import { inviteUsersToEvent, InviteUsersToEventResult } from "@/lib/data/event";
import { getMembers, isCircleAdmin, isCircleAdminOfAny } from "@/lib/data/member";
import { addCommentToDiscussion } from "@/lib/data/discussion";
import { getAllCommentsAction } from "@/components/modules/feeds/actions";
import { notifyEventGuestConfirmed } from "@/lib/data/notifications";
import { Comment } from "@/models/models";
import { filterTasksForViewer, getTasksByEventId } from "@/lib/data/task";
import { shouldShowEventCrewPanel, summarizeEventCrew, type EventCrewPanel } from "@/lib/tasks/event-crew-panel";
import { isProfileTabEvent } from "@/lib/events/profile-events";
import { resolveViewerIsAdmin } from "@/lib/data/circle";
import { canViewFollowerList } from "@/lib/data/follower-list-access";
import { listAcceptedConnectionsForUserDid, searchAcceptedConnectionsForUserDid } from "@/lib/data/relationships";
import { isPeerifyArtistIdentity, isPeerifyVenueIdentity } from "@/lib/peerify/artist-profile";
import {
    EVENT_LOCATION_REQUIRED_MESSAGE,
    eventNeedsLocation,
    parseUsableLocationInput,
} from "@/lib/utils/event-location";

// ----- Types -----

type GetEventsActionResult = {
    events: EventDisplay[];
};

type GetInvitedUsersActionResult = {
    users: Circle[];
};

type GetCircleMembersActionResult = {
    members: Circle[];
};

type GetCirclesBySearchQueryActionResult = {
    circles: Circle[];
};

type GetTasksByEventActionResult = {
    tasks: TaskDisplay[];
};

export type EventCrewPanelResult = EventCrewPanel & {
    // False when the host circle has neither Tasks nor Shifts on (the panel is then hidden).
    show: boolean;
    isOrganiser: boolean;
    canCreateShift: boolean;
    canCreateTask: boolean;
};

type HideCancelledEventResult = {
    success: boolean;
    message?: string;
};

// ----- Zod Schemas -----

const peerifyEventMetadataFormSchema = peerifyEventMetadataSchema.extend({
    publicMapLocation: locationSchema.nullish(),
});

const createEventSchema = z.object({
    title: z.string().min(1, "Title is required"),
    description: z.string().min(1, "Description is required"),
    images: z.array(z.any()).optional(),
    // JSON from LocationPicker. Not validated here: an empty or incomplete value means "no
    // location" (parseUsableLocationInput), and whether one is needed depends on isVirtual.
    location: z.string().optional(),
    userGroups: z.array(z.string()).optional(),
    isVirtual: z.string().optional(), // "on" / "true" / undefined
    isHybrid: z.string().optional(),
    virtualUrl: z.string().url().optional().or(z.literal("")).optional(),
    startAt: z.string().min(1, "Start date/time is required"),
    endAt: z.string().min(1, "End date/time is required"),
    allDay: z.string().optional(), // "on" / undefined
    categories: z.array(z.string()).optional(),
    causes: z.array(z.string()).optional(),
    // Deliberately loose: just confirm this is valid JSON shaped like an object, rather than
    // strictly matching eventTagsSchema here. A real stored event's tags field routinely comes
    // back from MongoDB with null values for whichever categories were never set (this
    // project's MongoClient has no ignoreUndefined option, so writing `{alcohol: undefined}`
    // persists as `{alcohol: null}`) — eventTagsSchema's z.enum().optional() fields only accept
    // undefined, not null, so parsing raw Mongo-shaped data against it here would reject a
    // completely untouched, valid-looking submission. normalizeEventTags (called after
    // validation succeeds, see below) is the actual authority on shape/enum correctness and
    // already treats null exactly like an unset field.
    tags: z
        .string()
        .optional()
        .refine(
            (val) => {
                if (!val) return true;
                try {
                    const parsed = JSON.parse(val);
                    return parsed === null || (typeof parsed === "object" && !Array.isArray(parsed));
                } catch {
                    return false;
                }
            },
            { message: "Invalid event tags format" },
        ),
    capacity: z.string().optional(), // parse to number
    placesTakenOutside: z.string().optional(), // parse to number; ignored without a capacity
    visibility: eventVisibilitySchema.optional(),
    peerifyEventMetadata: z
        .string()
        .optional()
        .refine(
            (val) => {
                if (!val) return true;
                try {
                    peerifyEventMetadataFormSchema.parse(JSON.parse(val));
                    return true;
                } catch {
                    return false;
                }
            },
            { message: "Invalid Peerify event metadata format" },
        ),
    recurrence: z
        .string()
        .optional()
        .refine(
            (val) => {
                if (!val) return true;
                try {
                    const parsed = JSON.parse(val);
                    return parsed.frequency && ["daily", "weekly", "monthly", "yearly"].includes(parsed.frequency);
                } catch {
                    return false;
                }
            },
            { message: "Invalid recurrence format" },
        ),
});

const updateEventSchema = createEventSchema;

// ----- Helpers -----

// Most zod validation failures on this form (missing title, bad URL, etc.) already produce a
// specific, actionable message worth showing verbatim. Tags are the exception: the technical
// message ("Invalid event tags format") doesn't tell a host anything they can act on, so this
// swaps in a plain-language one for that specific field while still logging the raw submitted
// value and zod issues server-side for debugging.
function buildEventValidationErrorResponse(
    validated: { success: false; error: z.ZodError },
    context: string,
    rawTags: FormDataEntryValue | null,
): { success: false; message: string } {
    const tagsIssue = validated.error.errors.find((issue) => issue.path[0] === "tags");
    if (tagsIssue) {
        console.error(`[${context}] Invalid event tags submitted:`, rawTags, JSON.stringify(validated.error.errors));
        return {
            success: false,
            message: "We couldn't save your event tags — please check your selections and try again.",
        };
    }
    return {
        success: false,
        message: `Invalid input: ${validated.error.errors.map((e) => e.message).join(", ")}`,
    };
}

function parseBool(val?: string): boolean | undefined {
    if (!val) return undefined;
    const v = (val || "").toLowerCase();
    return v === "true" || v === "on" ? true : v === "false" ? false : true;
}

function parseDate(val: string): Date {
    const d = new Date(val);
    if (isNaN(d.getTime())) {
        throw new Error(`Invalid date: ${val}`);
    }
    return d;
}

function normalizeRecurrenceEndDate(endDate?: Date): Date | undefined {
    if (!endDate) return undefined;
    if (
        endDate.getUTCHours() === 0 &&
        endDate.getUTCMinutes() === 0 &&
        endDate.getUTCSeconds() === 0 &&
        endDate.getUTCMilliseconds() === 0
    ) {
        const normalized = new Date(endDate);
        normalized.setUTCHours(23, 59, 59, 999);
        return normalized;
    }
    return endDate;
}

const shouldPublishToNoticeboard = (formData: FormData) => formData.get("publishToNoticeboard") === "true";

type ParsedPeerifyEventMetadata = {
    metadata: NonNullable<EventModel["metadata"]>;
    clearPublicLocationLabel: boolean;
    clearPrivateLocationNote: boolean;
    clearGuestNote: boolean;
    clearPublicMapLocation: boolean;
    clearPrice: boolean;
    clearPaymentInfo: boolean;
};

const parsePeerifyEventMetadata = (value?: string): ParsedPeerifyEventMetadata | undefined => {
    if (!value) {
        return undefined;
    }

    const raw = JSON.parse(value);
    const parsed = peerifyEventMetadataFormSchema.parse(raw);
    const publicLocationLabel = parsed.publicLocationLabel?.trim();
    const privateLocationNote = parsed.privateLocationNote?.trim();
    const guestNote = parsed.guestNote?.trim();
    const publicMapLocation = parsed.publicMapLocation ?? undefined;
    // `ticketed` gates persistence of price/currency/paymentInfo, not just their display — a
    // submit with the toggle off never saves them, even if the form still holds values (e.g. the
    // user re-toggled off after filling them in without clearing the fields).
    const ticketed = Boolean(parsed.ticketed);
    const price = ticketed && typeof parsed.price === "number" ? parsed.price : undefined;
    const paymentInfo = ticketed ? parsed.paymentInfo?.trim() : undefined;
    const peerify = {
        venueDisclosure: parsed.venueDisclosure ?? "public",
        locationDisclosure: parsed.locationDisclosure ?? "public",
        accessMode: parsed.accessMode ?? "open_rsvp",
        ticketed,
        ...(publicLocationLabel ? { publicLocationLabel } : {}),
        ...(privateLocationNote ? { privateLocationNote } : {}),
        ...(guestNote ? { guestNote } : {}),
        ...(publicMapLocation ? { publicMapLocation } : {}),
        ...(parsed.venueCircleId ? { venueCircleId: parsed.venueCircleId } : {}),
        // currency travels with price — no price means no currency to show either.
        ...(price !== undefined ? { price, currency: parsed.currency?.trim() || "EUR" } : {}),
        ...(paymentInfo ? { paymentInfo } : {}),
    };

    return {
        metadata: {
            peerify,
        },
        clearPublicLocationLabel: !publicLocationLabel,
        clearPrivateLocationNote: !privateLocationNote,
        clearGuestNote: !guestNote,
        clearPublicMapLocation: !publicMapLocation,
        clearPrice: price === undefined,
        clearPaymentInfo: !paymentInfo,
    };
};

const mergePeerifyEventMetadata = (
    existingMetadata: EventModel["metadata"] | undefined,
    peerifyMetadata: ParsedPeerifyEventMetadata | undefined,
): EventModel["metadata"] | undefined => {
    if (!peerifyMetadata?.metadata.peerify) {
        return existingMetadata;
    }

    const nextPeerify = {
        ...((existingMetadata?.peerify || {}) as Record<string, unknown>),
        ...peerifyMetadata.metadata.peerify,
    };
    if (peerifyMetadata.clearPublicLocationLabel) {
        delete nextPeerify.publicLocationLabel;
    }
    if (peerifyMetadata.clearPrivateLocationNote) {
        delete nextPeerify.privateLocationNote;
    }
    if (peerifyMetadata.clearGuestNote) {
        delete nextPeerify.guestNote;
    }
    if (peerifyMetadata.clearPublicMapLocation) {
        delete nextPeerify.publicMapLocation;
    }
    if (peerifyMetadata.clearPrice) {
        delete nextPeerify.price;
        delete nextPeerify.currency;
    }
    if (peerifyMetadata.clearPaymentInfo) {
        delete nextPeerify.paymentInfo;
    }

    return {
        ...(existingMetadata || {}),
        peerify: nextPeerify,
    };
};

// Pre-launch (Tim, 2026-10-20): events are public only. Every non-default value of the event
// form's "Venue & location privacy" settings (locationDisclosure, venueDisclosure, accessMode) and
// "private" visibility stay in the schema and the code, hidden rather than removed
// (SHOW_EVENT_PRIVACY_SECTION in event-form.tsx), so existing events keep working. A create can't
// choose them and an update can't switch to them; an existing event may keep the values it already
// has, so editing it doesn't fail.
const HIDDEN_EVENT_OPTION_MESSAGE = "Events can only be public, with a public address, for now.";
const PUBLIC_EVENT_PRIVACY_DEFAULTS = {
    locationDisclosure: "public",
    venueDisclosure: "public",
    accessMode: "open_rsvp",
} as const;
const usesHiddenEventOptions = (
    visibility: string | undefined,
    peerify: Partial<Record<keyof typeof PUBLIC_EVENT_PRIVACY_DEFAULTS, string>> | undefined,
    existing?: Pick<EventModel, "visibility" | "metadata">,
): boolean => {
    for (const [field, defaultValue] of Object.entries(PUBLIC_EVENT_PRIVACY_DEFAULTS)) {
        const key = field as keyof typeof PUBLIC_EVENT_PRIVACY_DEFAULTS;
        const value = peerify?.[key];
        const existingValue = existing?.metadata?.peerify?.[key] ?? defaultValue;
        if (value && value !== defaultValue && value !== existingValue) {
            return true;
        }
    }
    return visibility === "private" && existing?.visibility !== "private";
};

const getEventInternalPreviewUrl = (circleHandle: string, eventId: string) => {
    const baseUrl = (process.env.CIRCLES_URL || "http://localhost:3000").replace(/\/+$/, "");
    return `${baseUrl}/circles/${circleHandle}/events/${eventId}?source=noticeboard`;
};

const buildEventNoticeboardPostContent = (event: Pick<EventModel, "description">) => {
    const description = event.description.trim();
    return description ? `Attend this event. ${description}` : "Attend this event.";
};

const upsertEventNoticeboardPost = async ({
    circle,
    circleHandle,
    event,
}: {
    circle: Circle;
    circleHandle: string;
    event: Pick<EventModel, "_id" | "title" | "description" | "createdBy" | "noticeboardPostId" | "userGroups">;
}): Promise<string | null> => {
    if (!circle._id || !event._id) {
        return null;
    }

    let feed = await getFeedByHandle(circle._id.toString(), "default");
    if (!feed) {
        feed = await createDefaultFeed(circle._id.toString());
    }
    if (!feed?._id) {
        throw new Error("Noticeboard feed not found.");
    }

    const eventId = event._id.toString();
    const postData: Partial<Post> = {
        title: event.title,
        content: buildEventNoticeboardPostContent(event),
        feedId: feed._id.toString(),
        createdBy: event.createdBy,
        createdAt: new Date(),
        editedAt: new Date(),
        reactions: {},
        comments: 0,
        userGroups: event.userGroups ?? [],
        postType: "post",
        internalPreviewType: "event",
        internalPreviewId: eventId,
        internalPreviewUrl: getEventInternalPreviewUrl(circleHandle, eventId),
    };

    if (event.noticeboardPostId) {
        try {
            // Deliberately omit userGroups here: once the post exists, its audience is a
            // per-post setting the host curates directly via the post's own edit dialog
            // (see post-form.tsx). Re-syncing title/content on every event edit must not
            // clobber that back to the post's original audience on every resync.
            await updatePost({
                _id: event.noticeboardPostId,
                title: postData.title,
                content: postData.content,
                editedAt: new Date(),
                postType: postData.postType,
                internalPreviewType: postData.internalPreviewType,
                internalPreviewId: postData.internalPreviewId,
                internalPreviewUrl: postData.internalPreviewUrl,
            });
            return event.noticeboardPostId;
        } catch (error) {
            console.error("Failed to update linked noticeboard post for event:", error);
        }
    }

    const createdPost = await createPost(
        await postSchema.parseAsync({
            ...postData,
            createdAt: new Date(),
            editedAt: undefined,
        }),
    );
    return createdPost._id?.toString?.() ?? createdPost._id ?? null;
};

// How many guests are confirmed on an event (its base document for a recurring occurrence).
const countConfirmedGuestsOf = async (eventId: string): Promise<number> => {
    const baseEventId = String(eventId).split("_")[0];
    if (!ObjectId.isValid(baseEventId)) return 0;
    const event = await Events.findOne(
        { _id: new ObjectId(baseEventId) },
        { projection: { guestConfirmations: 1 } },
    );
    return event ? countConfirmedGuests(event) : 0;
};

// ----- Actions -----

/**
 * Get list of events for a circle (optionally filtered by range)
 */
export async function getEventsAction(
    circleHandle: string,
    params?: { from?: string; to?: string },
    includeCreated?: boolean,
    includeParticipating?: boolean,
): Promise<GetEventsActionResult> {
    const defaultResult: GetEventsActionResult = { events: [] };

    try {
        const userDid = await getAuthenticatedUserDid();

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return defaultResult;
        // Unpublished: nothing, as for a missing handle, unless the viewer may open the circle
        // (signed-in viewers' events.view includes "everyone", so it doesn't stop strangers).
        if (!(await canViewerOpenCircle(circle, userDid))) return defaultResult;

        const range =
            params && (params.from || params.to)
                ? {
                      from: params.from ? parseDate(params.from) : undefined,
                      to: params.to ? parseDate(params.to) : undefined,
                  }
                : undefined;

        const isPublicEvents = !userDid && (await canAnonymousViewCircleEvents(circle));
        if (isPublicEvents) {
            const events = await getPublicEventsByCircleId(circle._id!.toString(), range);
            return { events };
        }

        if (!userDid) return defaultResult;

        const canView = await isAuthorized(userDid, circle._id as string, features.events.view);
        if (!canView) return defaultResult;

        const fetched = await getEventsByCircleId(
            circle._id!.toString(),
            userDid,
            range,
            includeCreated,
            includeParticipating,
        );
        // A personal profile lists only open, public events the person created on it
        // (lib/events/profile-events.ts). The one exception is the owner asking for their own
        // created/participating events (the user toolbox); the profile's Events tab doesn't ask.
        const isPersonalProfile = circle.circleType === "user";
        const viewerIsOwner = isPersonalProfile && circle.did === userDid;
        const isOwnerOwnList = viewerIsOwner && Boolean(includeCreated || includeParticipating);
        const events =
            isPersonalProfile && !isOwnerOwnList
                ? fetched.filter((event) => isProfileTabEvent(event, circle, viewerIsOwner))
                : fetched;
        // Unshaped from the data layer: hidden addresses, private notes, drafts and members-only
        // events must not reach viewers who don't manage them (leak round 3, 2026-11-05).
        return { events: await shapeEventsForViewer(events, userDid) };
    } catch (error) {
        console.error("Error in getEventsAction:", error);
        return defaultResult;
    }
}

/**
 * Get single event by id
 */
export async function getEventAction(circleHandle: string, eventId: string): Promise<EventDisplay | null> {
    try {
        const userDid = await getAuthenticatedUserDid();

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return null;
        // Unpublished: nothing, as for a missing handle, unless the viewer may open the circle
        // (signed-in viewers' events.view includes "everyone", so it doesn't stop strangers).
        if (!(await canViewerOpenCircle(circle, userDid))) return null;

        const isPublicEvents = !userDid && (await canAnonymousViewCircleEvents(circle));
        if (isPublicEvents) {
            return getPublicEventByIdForCircle(circle._id!.toString(), eventId);
        }

        if (!userDid) return null;

        const canView = await isAuthorized(userDid, circle._id as string, features.events.view);
        if (!canView) return null;

        const event = await getEventById(eventId, userDid);
        if (!event) return null;
        // The event must belong to this circle. An event can move to another host
        // (changeEventHostAction; the page then redirects to the new handle), so a different
        // host is allowed only if the viewer may also see that circle's events.
        if (event.circleId !== String(circle._id)) {
            const canViewHost = await isAuthorized(userDid, event.circleId, features.events.view);
            if (!canViewHost) return null;
        }
        return shapeEventForViewer(event, userDid);
    } catch (error) {
        console.error("Error in getEventAction:", error);
        return null;
    }
}

/**
 * Get tasks linked to an event
 */
export async function getTasksByEventAction(
    circleHandle: string,
    eventId: string,
): Promise<GetTasksByEventActionResult> {
    const defaultResult: GetTasksByEventActionResult = { tasks: [] };

    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return defaultResult;

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return defaultResult;

        // Require permission to view events (mirrors event detail access)
        const canViewEvents = await isAuthorized(userDid, circle._id as string, features.events.view);
        if (!canViewEvents) return defaultResult;

        // Same per-viewer rules as the task list: tasks.view, each task's audience, workflow notes
        // (leak round 3, M5).
        const tasks = await filterTasksForViewer(await getTasksByEventId(eventId, circle._id!.toString()), userDid);
        return { tasks };
    } catch (error) {
        console.error("Error in getTasksByEventAction:", error);
        return defaultResult;
    }
}

/**
 * The event page's crew panel (Crew R1, item 3): the event's shifts (time, slots, confirmed and
 * pending counts, the viewer's own status; who signed up for organisers only) and tasks (stage,
 * assignee). Signed-in viewers who can see the event only; tasks and shifts go through
 * filterTasksForViewer (audience, D3, decision B) first.
 */
export async function getEventCrewPanelAction(circleHandle: string, eventId: string): Promise<EventCrewPanelResult> {
    const hidden: EventCrewPanelResult = {
        show: false,
        isOrganiser: false,
        canCreateShift: false,
        canCreateTask: false,
        shifts: [],
        tasks: [],
    };

    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return hidden;

        const circle = await getCircleByHandle(circleHandle);
        if (!circle?._id) return hidden;
        const circleId = circle._id.toString();

        const tasksEnabled = circle.enabledModules?.includes("tasks") ?? false;
        const shiftsEnabled = circle.enabledModules?.includes("shifts") ?? false;
        if (!tasksEnabled && !shiftsEnabled) return hidden;

        // Same access as the event page itself (events.view, the event's audience).
        const event = await getEventAction(circleHandle, eventId);
        if (!event) return hidden;

        const [canAssign, canModerate, isPlatformAdmin, canCreate] = await Promise.all([
            isAuthorized(userDid, circleId, features.tasks.assign),
            isAuthorized(userDid, circleId, features.tasks.moderate),
            resolveViewerIsAdmin(userDid),
            isAuthorized(userDid, circleId, features.tasks.create),
        ]);
        const isOrganiser = canAssign || canModerate || isPlatformAdmin;

        const linked = await filterTasksForViewer(await getTasksByEventId(eventId, circleId), userDid);
        const visible = linked.filter((task) =>
            (task.taskType ?? "outcome") === "shift" ? shiftsEnabled : tasksEnabled,
        );

        let profilesByDid: Map<string, Circle> | undefined;
        if (isOrganiser) {
            const dids = Array.from(
                new Set(visible.flatMap((task) => (task.participants ?? []).map((participant) => participant.userDid))),
            );
            const profiles = dids.length > 0 ? await getCirclesByDids(dids, { viewerDid: userDid }) : [];
            profilesByDid = new Map(profiles.filter((p) => p.did).map((p) => [p.did as string, p]));
        }

        const canCreateShift = shiftsEnabled && canCreate;
        const canCreateTask = tasksEnabled && canCreate;
        const summary = summarizeEventCrew(visible, { viewerDid: userDid, isOrganiser, profilesByDid });
        // Nothing to see and nothing to create (e.g. a follower who isn't crew): no panel at all,
        // not "No shifts or tasks linked yet" (Tim, 2026-11-15).
        if (!shouldShowEventCrewPanel(summary, { canCreateShift, canCreateTask })) return hidden;

        return { show: true, isOrganiser, canCreateShift, canCreateTask, ...summary };
    } catch (error) {
        console.error("Error in getEventCrewPanelAction:", error);
        return hidden;
    }
}

/**
 * Create event
 */
export async function createEventAction(
    circleHandle: string,
    formData: FormData,
): Promise<{ success: boolean; message?: string; eventId?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const user = await getUserByDid(userDid);
        if (!user) return { success: false, message: "User not found" };

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return { success: false, message: "Circle not found" };

        const canCreate = await isAuthorized(userDid, circle._id as string, features.events.create);
        if (!canCreate) return { success: false, message: "Not authorized to create events" };

        const validated = createEventSchema.safeParse({
            title: formData.get("title"),
            description: formData.get("description"),
            images: formData.getAll("images"),
            location: formData.get("location") ?? undefined,
            userGroups: formData.getAll("userGroups"),
            isVirtual: (formData.get("isVirtual") as string) ?? undefined,
            isHybrid: (formData.get("isHybrid") as string) ?? undefined,
            virtualUrl: (formData.get("virtualUrl") as string) ?? undefined,
            startAt: (formData.get("startAt") as string) ?? "",
            endAt: (formData.get("endAt") as string) ?? "",
            allDay: (formData.get("allDay") as string) ?? undefined,
            categories: formData.getAll("categories"),
            causes: formData.getAll("causes"),
            tags: (formData.get("tags") as string) ?? undefined,
            capacity: (formData.get("capacity") as string) ?? undefined,
            placesTakenOutside: (formData.get("placesTakenOutside") as string) ?? undefined,
            visibility: (formData.get("visibility") as string) ?? undefined,
            peerifyEventMetadata: (formData.get("peerifyEventMetadata") as string) ?? undefined,
            recurrence: (formData.get("recurrence") as string) ?? undefined,
        });
        if (!validated.success) {
            return buildEventValidationErrorResponse(validated, "createEventAction", formData.get("tags"));
        }
        const data = validated.data;

        // Parse primitives
        const startAt = parseDate(data.startAt);
        const endAt = parseDate(data.endAt);
        const allDay = parseBool(data.allDay) ?? false;
        const isVirtual = parseBool(data.isVirtual);
        const isHybrid = parseBool(data.isHybrid);
        const virtualUrl = (data.virtualUrl || "").trim() || undefined;
        const parsedCapacity = parseEventCapacity(data.capacity);
        if (!parsedCapacity.ok) return { success: false, message: parsedCapacity.message };
        const capacity = parsedCapacity.capacity;
        const parsedOutside = parsePlacesTakenOutside(data.placesTakenOutside);
        if (!parsedOutside.ok) return { success: false, message: parsedOutside.message };
        // No capacity, no limit: nothing to count outside places against.
        const placesTakenOutside = capacity === undefined ? 0 : parsedOutside.value;
        if (capacity !== undefined && placesTakenOutside > capacity) {
            return { success: false, message: capacityBelowConfirmedMessage(0, placesTakenOutside) };
        }

        const locationData: EventModel["location"] = parseUsableLocationInput(data.location);
        if (eventNeedsLocation(isVirtual, isHybrid) && !locationData) {
            return { success: false, message: EVENT_LOCATION_REQUIRED_MESSAGE };
        }

        let recurrenceData: EventModel["recurrence"] = undefined;
        if (data.recurrence) {
            recurrenceData = JSON.parse(data.recurrence);
            if (recurrenceData?.endDate) {
                recurrenceData.endDate = normalizeRecurrenceEndDate(new Date(recurrenceData.endDate));
            }
        }

        // The create form seeds its tag picker from circle.defaultEventTags and lets the host
        // edit it before submitting (see event-form.tsx), so a submitted value here reflects
        // that possibly-edited selection and takes precedence. Falling back to the circle's
        // current default only covers callers that never send a "tags" field at all.
        let submittedTags: EventTagsValue | undefined;
        if (data.tags) {
            submittedTags = JSON.parse(data.tags);
        }

        const metadata = withPlacesTakenOutside(
            parsePeerifyEventMetadata(data.peerifyEventMetadata)?.metadata,
            placesTakenOutside,
        );
        if (usesHiddenEventOptions(data.visibility, metadata?.peerify)) {
            return { success: false, message: HIDDEN_EVENT_OPTION_MESSAGE };
        }

        // Handle images
        const imageFiles = (data.images || []).filter(isFile);
        let uploadedImages: Media[] = [];
        if (imageFiles.length > 0) {
            const uploadPromises = imageFiles.map(async (file) => {
                const prefix = `event_image_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                return await saveFile(file, prefix, circle._id as string, true);
            });
            const uploadResults = await Promise.all(uploadPromises);
            uploadedImages = uploadResults.map(
                (result: StorageFileInfo): Media => ({
                    name: result.originalName || "Uploaded Image",
                    type: imageFiles.find((f) => f.name === result.originalName)?.type || "application/octet-stream",
                    fileInfo: {
                        url: result.url,
                        fileName: result.fileName,
                        originalName: result.originalName,
                    },
                }),
            );
        }

        // Build event payload
        const newEvent: Omit<EventModel, "_id" | "commentPostId"> = {
            circleId: circle._id!.toString(),
            createdBy: userDid,
            createdAt: new Date(),
            updatedAt: new Date(),
            title: data.title,
            description: data.description,
            images: uploadedImages,
            location: locationData,
            stage: "draft",
            userGroups: data.userGroups && data.userGroups.length > 0 ? data.userGroups : ["everyone"],
            publishToNoticeboard: shouldPublishToNoticeboard(formData),
            isVirtual,
            virtualUrl,
            isHybrid,
            startAt,
            endAt,
            allDay,
            categories: (data.categories as string[])?.filter(Boolean),
            causes: (data.causes as string[])?.filter(Boolean),
            // Snapshot (not reference) the host circle's default feature-icon tags onto the new
            // event; normalizeEventTags builds a fresh, validated object, so this is never the
            // same object as circle.defaultEventTags or as submittedTags. Independently
            // overridable after creation. Only Venue circles have a meaningful circle-level
            // default (see about-settings-form.tsx) — other circle types fall back to no tags.
            tags: normalizeEventTags(submittedTags ?? (isPeerifyVenueIdentity(circle) ? circle.defaultEventTags : undefined)),
            capacity,
            visibility: (data.visibility as any) ?? "public",
            metadata,
            recurrence: recurrenceData,
        };

        // Create in DB (will also create shadow post if feed exists)
        const created = await createEventDb(newEvent, user);

        // Ensure module enabled on user's own circle. Done before revalidatePath so the
        // revalidated /events page reflects an already-enabled module rather than racing it.
        try {
            if (circle.circleType === "user" && circle.did === userDid) {
                const enabled = await ensureModuleIsEnabledOnCircle(circle._id as string, "events", userDid);
                if (!enabled) {
                    // ensureModuleIsEnabledOnCircle swallows its own errors and returns false rather
                    // than throwing, so this is the only signal we get that the user's own Events
                    // tab may now 404 despite the event having been created successfully.
                    console.warn(
                        `Events module was not enabled on user circle ${circle._id} after event creation — the user's own Events tab may 404.`,
                    );
                }
            }
        } catch (err) {
            console.error("Failed to ensure events module is enabled on user circle:", err);
        }

        // Revalidate list
        revalidatePath(`/circles/${circleHandle}/events`);

        // Note: no Noticeboard sync here even if publishToNoticeboard is set — new events are
        // always created in "draft" stage (see above), and the linked post is only ever
        // created/synced once the event actually transitions to "open" (changeEventStageAction).
        // The `publishToNoticeboard` flag persisted above is what that transition checks.

        return { success: true, message: "Event created successfully", eventId: created._id?.toString() };
    } catch (error) {
        console.error("Error creating event:", error);
        return { success: false, message: "Failed to create event" };
    }
}

/**
 * Update event
 */
export async function updateEventAction(
    circleHandle: string,
    eventId: string,
    formData: FormData,
): Promise<{ success: boolean; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return { success: false, message: "Circle not found" };

        const event = await getEventById(eventId, userDid);
        if (!event) return { success: false, message: "Event not found" };

        const isAuthor = userDid === event.createdBy;
        const canModerate = await isAuthorized(userDid, circle._id as string, features.events.moderate);
        const isArtistAdmin = await isCircleAdminOfAny(userDid, event.artistAdminCircleIds);
        const canEdit = isAuthor || canModerate || isArtistAdmin;
        if (!canEdit) return { success: false, message: "Not authorized to update this event" };

        const validated = updateEventSchema.safeParse({
            title: formData.get("title"),
            description: formData.get("description"),
            images: formData.getAll("images"),
            location: formData.get("location") ?? undefined,
            userGroups: formData.getAll("userGroups"),
            isVirtual: (formData.get("isVirtual") as string) ?? undefined,
            isHybrid: (formData.get("isHybrid") as string) ?? undefined,
            virtualUrl: (formData.get("virtualUrl") as string) ?? undefined,
            startAt: (formData.get("startAt") as string) ?? event.startAt?.toString() ?? "",
            endAt: (formData.get("endAt") as string) ?? event.endAt?.toString() ?? "",
            allDay: (formData.get("allDay") as string) ?? undefined,
            categories: formData.getAll("categories"),
            causes: formData.getAll("causes"),
            tags: (formData.get("tags") as string) ?? undefined,
            capacity: (formData.get("capacity") as string) ?? undefined,
            placesTakenOutside: (formData.get("placesTakenOutside") as string) ?? undefined,
            visibility: (formData.get("visibility") as string) ?? undefined,
            peerifyEventMetadata: (formData.get("peerifyEventMetadata") as string) ?? undefined,
            recurrence: (formData.get("recurrence") as string) ?? undefined,
        });
        if (!validated.success) {
            return buildEventValidationErrorResponse(validated, "updateEventAction", formData.get("tags"));
        }
        const data = validated.data;
        const parsedPeerifyMetadata = parsePeerifyEventMetadata(data.peerifyEventMetadata);
        if (usesHiddenEventOptions(data.visibility, parsedPeerifyMetadata?.metadata.peerify, event)) {
            return { success: false, message: HIDDEN_EVENT_OPTION_MESSAGE };
        }
        // Checked before any upload; the write below checks it again atomically.
        const parsedCapacity = parseEventCapacity(data.capacity);
        if (!parsedCapacity.ok) return { success: false, message: parsedCapacity.message };
        const parsedOutside = parsePlacesTakenOutside(data.placesTakenOutside);
        if (!parsedOutside.ok) return { success: false, message: parsedOutside.message };
        // No capacity, no limit: clearing the capacity clears the places taken outside too.
        const placesTakenOutside = parsedCapacity.capacity === undefined ? 0 : parsedOutside.value;
        if (parsedCapacity.capacity !== undefined) {
            const confirmed = await countConfirmedGuestsOf(eventId);
            if (confirmed + placesTakenOutside > parsedCapacity.capacity) {
                return { success: false, message: capacityBelowConfirmedMessage(confirmed, placesTakenOutside) };
            }
        }

        // Only replaced when the form sends one; an empty or incomplete value clears it. Not
        // required here even for physical events: existing events without a location must stay
        // editable (createEventAction enforces it for new ones).
        let locationData: EventModel["location"] = event.location;
        if (data.location) {
            locationData = parseUsableLocationInput(data.location);
        }

        // Tags are edited independently of the circle's defaultEventTags once an event exists —
        // fall back to the event's own current tags (never the circle) when the form doesn't
        // submit a value, so a circle default changed later can't leak into an already-created
        // event on save.
        let tagsData: EventTagsValue | undefined = event.tags;
        if (data.tags) {
            try {
                tagsData = JSON.parse(data.tags);
            } catch {
                /* already validated */
            }
        }

        let recurrenceData: EventModel["recurrence"] | null = event.recurrence ?? undefined;
        const rawRecurrence = formData.get("recurrence") as string | null;
        console.log(`[updateEventAction] Event ${eventId} - Raw Recurrence:`, rawRecurrence);

        if (rawRecurrence && rawRecurrence.trim() !== "") {
            try {
                recurrenceData = JSON.parse(rawRecurrence);
                if (recurrenceData?.endDate) {
                    recurrenceData.endDate = normalizeRecurrenceEndDate(new Date(recurrenceData.endDate));
                }
            } catch (e) {
                console.error("[updateEventAction] Failed to parse recurrence:", e);
            }
        } else if (rawRecurrence === "") {
            console.log("[updateEventAction] Clearing recurrence");
            recurrenceData = null; // Explicitly clear
        }

        // Reconcile images
        const existingImages = event.images || [];
        const submittedImageEntries = data.images || [];
        const newFiles = submittedImageEntries.filter(isFile);
        const existingMediaJsonStrings = submittedImageEntries.filter((e): e is string => typeof e === "string");

        let parsedExistingMedia: Media[] = [];
        try {
            parsedExistingMedia = existingMediaJsonStrings.map((s) => JSON.parse(s));
        } catch {
            return { success: false, message: "Failed to process existing image data." };
        }

        const remainingExistingUrls = new Set(parsedExistingMedia.map((m) => m?.fileInfo?.url));
        const toDelete = existingImages.filter((img) => !remainingExistingUrls.has(img.fileInfo.url));

        // Upload new
        let newlyUploaded: Media[] = [];
        if (newFiles.length > 0) {
            const uploadPromises = newFiles.map(async (file) => {
                const prefix = `event_image_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                return await saveFile(file, prefix, circle._id as string, true);
            });
            const results = await Promise.all(uploadPromises);
            newlyUploaded = results.map(
                (r: StorageFileInfo): Media => ({
                    name: r.originalName || "Uploaded Image",
                    type: newFiles.find((f) => f.name === r.originalName)?.type || "application/octet-stream",
                    fileInfo: {
                        url: r.url,
                        fileName: r.fileName,
                        originalName: r.originalName,
                    },
                }),
            );
        }

        if (toDelete.length > 0) {
            await Promise.allSettled(toDelete.map((img) => deleteFile(img.fileInfo.url)));
        }

        const startAt = data.startAt ? parseDate(data.startAt) : event.startAt;
        const endAt = data.endAt ? parseDate(data.endAt) : event.endAt;
        const metadata = withPlacesTakenOutside(
            mergePeerifyEventMetadata(event.metadata, parsedPeerifyMetadata),
            placesTakenOutside,
        );

        const updateData: Partial<EventModel> = {
            title: data.title,
            description: data.description,
            images: [...parsedExistingMedia, ...newlyUploaded],
            location: locationData,
            userGroups: data.userGroups && data.userGroups.length > 0 ? data.userGroups : ["everyone"],
            isVirtual: parseBool(data.isVirtual),
            isHybrid: parseBool(data.isHybrid),
            virtualUrl: (data.virtualUrl || "").trim() || undefined,
            allDay: parseBool(data.allDay) ?? event.allDay,
            startAt,
            endAt,
            categories: (data.categories as string[])?.filter(Boolean),
            causes: (data.causes as string[])?.filter(Boolean),
            tags: normalizeEventTags(tagsData),
            capacity: parsedCapacity.capacity,
            visibility: (data.visibility as any) ?? event.visibility,
            metadata,
            recurrence: recurrenceData as any,
            publishToNoticeboard: shouldPublishToNoticeboard(formData),
            updatedAt: new Date(),
        };

        const user = await getUserByDid(userDid);
        if (!user) return { success: false, message: "User not found" };

        // The capacity can't go below the guests already confirmed plus the places taken outside
        // Peerify. Set both first with that condition in the write, so a confirm landing meanwhile
        // can't leave more places taken than there are. The whole metadata is set (not the nested
        // path): an older event may store `metadata: null`, which a dotted $set can't write into.
        if (parsedCapacity.capacity !== undefined) {
            const capacitySet = await Events.updateOne(
                {
                    _id: new ObjectId(eventId),
                    ...confirmedFitWithinFilter(parsedCapacity.capacity, placesTakenOutside),
                },
                { $set: { capacity: parsedCapacity.capacity, metadata } },
            );
            if (capacitySet.matchedCount === 0) {
                const confirmed = await countConfirmedGuestsOf(eventId);
                return { success: false, message: capacityBelowConfirmedMessage(confirmed, placesTakenOutside) };
            }
        }

        const success = await updateEventDb(eventId, updateData, user);
        if (!success) return { success: false, message: "Failed to update event" };

        // Only resync the linked Noticeboard post while the event is already open — for
        // draft/review, `publishToNoticeboard` above just records host intent, and the post
        // itself is created for the first time on the draft/review -> open transition (see
        // changeEventStageAction). This mirrors the "no live post while draft" fix.
        if (event.stage === "open" && shouldPublishToNoticeboard(formData)) {
            try {
                const noticeboardPostId = await upsertEventNoticeboardPost({
                    circle,
                    circleHandle,
                    event: {
                        ...event,
                        ...updateData,
                        _id: eventId,
                        createdBy: event.createdBy,
                        noticeboardPostId: event.noticeboardPostId,
                    },
                });
                if (noticeboardPostId && noticeboardPostId !== event.noticeboardPostId) {
                    await Events.updateOne({ _id: new ObjectId(eventId) }, { $set: { noticeboardPostId } });
                }
                revalidatePath(`/circles/${circleHandle}/feed`);
            } catch (error) {
                console.error("Failed to create linked noticeboard post for event:", error);
                return { success: true, message: "Event updated, but Noticeboard post could not be created." };
            }
        }

        revalidatePath(`/circles/${circleHandle}/events`);
        revalidatePath(`/circles/${circleHandle}/events/${eventId}`);
        return { success: true, message: "Event updated successfully" };
    } catch (error) {
        console.error("Error updating event:", error);
        return { success: false, message: "Failed to update event" };
    }
}

/**
 * Delete event
 */
export async function deleteEventAction(
    circleHandle: string,
    eventId: string,
): Promise<{ success: boolean; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return { success: false, message: "Circle not found" };

        const event = await getEventById(eventId, userDid);
        if (!event) return { success: false, message: "Event not found" };

        const isAuthor = userDid === event.createdBy;
        const canModerate = await isAuthorized(userDid, circle._id as string, features.events.moderate);
        if (!isAuthor && !canModerate) return { success: false, message: "Not authorized to delete this event" };

        // delete images
        if (event.images?.length) {
            await Promise.allSettled(event.images.map((img) => deleteFile(img.fileInfo.url)));
        }

        const success = await deleteEventDb(eventId);
        if (!success) return { success: false, message: "Failed to delete event" };

        revalidatePath(`/circles/${circleHandle}/events`);
        return { success: true, message: "Event deleted successfully" };
    } catch (error) {
        console.error("Error deleting event:", error);
        return { success: false, message: "Failed to delete event" };
    }
}

// ----- Host change -----

/**
 * Change an event's host circle — available on both draft and published events, gated on being
 * the event's creator (not canModerate/canEdit; this is deliberately narrower, matching the spec
 * that only the creator can initiate a host change). If the creator is an admin/owner of the
 * target circle, the change is instant. Otherwise a pending eventHostChangeRequest is created for
 * the target circle's admins to approve — see approveEventHostChangeRequestAction/
 * rejectEventHostChangeRequestAction.
 */
export async function changeEventHostAction(
    circleHandle: string,
    eventId: string,
    targetCircleHandle: string,
): Promise<{ success: boolean; message?: string; pending?: boolean; newCircleHandle?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const event = await getEventById(eventId, userDid);
        if (!event) return { success: false, message: "Event not found" };

        if (event.createdBy !== userDid) {
            return { success: false, message: "Only the event's creator can change its host" };
        }

        const targetCircle = await getCircleByHandle(targetCircleHandle);
        if (!targetCircle?._id) return { success: false, message: "Target circle not found" };

        const fromCircleId = event.circleId;
        const targetCircleId = targetCircle._id.toString();
        if (targetCircleId === fromCircleId) {
            return { success: false, message: "This is already the event's host" };
        }

        const isTargetAdminOrOwner =
            targetCircle.did === userDid || (await isCircleAdmin(userDid, targetCircleId));

        if (isTargetAdminOrOwner) {
            const applied = await applyEventHostChange(eventId, fromCircleId, targetCircleId);
            if (!applied) return { success: false, message: "Failed to change event host" };

            revalidatePath(`/circles/${circleHandle}/events/${eventId}`);
            revalidatePath(`/circles/${circleHandle}/events`);
            revalidatePath(`/circles/${targetCircle.handle}/events/${eventId}`);
            revalidatePath(`/circles/${targetCircle.handle}/events`);

            return {
                success: true,
                message: `Event moved to ${targetCircle.name || targetCircle.handle}`,
                newCircleHandle: targetCircle.handle,
            };
        }

        // Not an admin of the target circle — needs the target's approval before it takes effect.
        const existingRequest = await getPendingEventHostChangeRequestForEvent(eventId);
        if (existingRequest) {
            return {
                success: false,
                message:
                    existingRequest.toCircleId === targetCircleId
                        ? "A request to move this event there is already pending"
                        : "A different host-change request is already pending for this event",
            };
        }

        await createPendingEventHostChangeRequest(eventId, fromCircleId, targetCircleId, userDid);

        const requester = await getUserByDid(userDid);
        await notifyEventHostChangeRequested({ _id: event._id, title: event.title }, targetCircleId, requester);

        // success: false here is deliberate — the event's host hasn't actually changed yet, only
        // a pending request was created. `pending: true` is what tells the caller this wasn't an
        // error, just not an immediate change (see event-detail.tsx's onChangeHost).
        return {
            success: false,
            pending: true,
            message: `Request sent to ${targetCircle.name || targetCircle.handle} — waiting for their approval`,
        };
    } catch (error) {
        console.error("Error changing event host:", error);
        return { success: false, message: "Failed to change event host" };
    }
}

export type EventHostChangeRequestDisplay = {
    _id: string;
    eventId: string;
    eventTitle?: string;
    fromCircleName?: string;
    fromCircleHandle?: string;
    requesterName?: string;
    requestedAt: Date;
};

/**
 * List an event host-change requests pending FOR a circle (i.e. this circle is the requested new
 * host) — gated on being an admin/owner of that circle, same check approve/reject use. Fetches
 * event titles directly off the Events collection rather than through getEventById, since the
 * reviewing admin isn't necessarily authorized to view the event under its normal visibility
 * rules (it belongs to a different circle) — reviewing a request implicitly needs to see the
 * basic details regardless.
 */
export async function getEventHostChangeRequestsForCircleAction(
    circleHandle: string,
): Promise<{ success: boolean; requests?: EventHostChangeRequestDisplay[]; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const circle = await getCircleByHandle(circleHandle);
        if (!circle?._id) return { success: false, message: "Circle not found" };

        const canManage = circle.did === userDid || (await isCircleAdmin(userDid, circle._id as string));
        if (!canManage) return { success: false, message: "Not authorized to manage this circle's requests" };

        const pending = await getPendingEventHostChangeRequestsForCircle(circle._id as string);

        const requests = await Promise.all(
            pending.map(async (request) => {
                const [eventDoc, fromCircle, requester] = await Promise.all([
                    Events.findOne({ _id: new ObjectId(request.eventId) }, { projection: { title: 1 } }),
                    getCircleById(request.fromCircleId),
                    getUserByDid(request.requestedBy),
                ]);
                return {
                    _id: (request._id as any)?.toString?.() || String(request._id),
                    eventId: request.eventId,
                    eventTitle: eventDoc?.title,
                    fromCircleName: fromCircle?.name,
                    fromCircleHandle: fromCircle?.handle,
                    requesterName: requester?.name,
                    requestedAt: request.requestedAt,
                };
            }),
        );

        return { success: true, requests };
    } catch (error) {
        console.error("Error getting event host change requests:", error);
        return { success: false, message: "Failed to load requests" };
    }
}

async function decideEventHostChangeRequest(
    requestId: string,
    decision: "approved" | "rejected",
): Promise<{ success: boolean; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const request = await getEventHostChangeRequest(requestId);
        if (request.status !== "pending") {
            return { success: false, message: "This request has already been decided" };
        }

        const targetCircle = await getCircleById(request.toCircleId);
        if (!targetCircle?._id) return { success: false, message: "Target circle not found" };

        const canDecide = targetCircle.did === userDid || (await isCircleAdmin(userDid, request.toCircleId));
        if (!canDecide) return { success: false, message: "Not authorized to decide this request" };

        if (decision === "approved") {
            const applied = await applyEventHostChange(request.eventId, request.fromCircleId, request.toCircleId);
            if (!applied) return { success: false, message: "Failed to change event host" };
        }

        await updateEventHostChangeRequestStatus(requestId, decision);

        const eventDoc = await Events.findOne({ _id: new ObjectId(request.eventId) }, { projection: { title: 1 } });
        await notifyEventHostChangeDecided(
            { _id: request.eventId, title: eventDoc?.title || "your event" },
            targetCircle,
            request.requestedBy,
            decision === "approved",
        );

        revalidatePath(`/circles/${targetCircle.handle}/settings/event-host-requests`);
        if (decision === "approved") {
            revalidatePath(`/circles/${targetCircle.handle}/events/${request.eventId}`);
            revalidatePath(`/circles/${targetCircle.handle}/events`);
        }

        return { success: true, message: decision === "approved" ? "Request approved — event moved" : "Request rejected" };
    } catch (error) {
        console.error(`Error deciding event host change request (${decision}):`, error);
        return { success: false, message: "Failed to decide request" };
    }
}

export async function approveEventHostChangeRequestAction(
    requestId: string,
): Promise<{ success: boolean; message?: string }> {
    return decideEventHostChangeRequest(requestId, "approved");
}

export async function rejectEventHostChangeRequestAction(
    requestId: string,
): Promise<{ success: boolean; message?: string }> {
    return decideEventHostChangeRequest(requestId, "rejected");
}

// ----- Multi-artist support -----

export type EventArtistBand = {
    circle: Circle;
    isAdminDelegated: boolean;
    currentUserIsAdmin: boolean;
};

/**
 * Add an artist/band circle to an event's lineup. Gated the same as event edits (author or
 * moderator) — being an artist admin does not by itself grant the ability to add other artists.
 */
export async function addArtistToEvent(
    circleHandle: string,
    eventId: string,
    circleId: string,
): Promise<{ success: boolean; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return { success: false, message: "Circle not found" };

        const event = await getEventById(eventId, userDid);
        if (!event) return { success: false, message: "Event not found" };

        const isAuthor = userDid === event.createdBy;
        const canModerate = await isAuthorized(userDid, circle._id as string, features.events.moderate);
        if (!isAuthor && !canModerate) {
            return { success: false, message: "Not authorized to add artists to this event" };
        }

        const artistCircle = await getCircleById(circleId);
        // Unpublished artists can't be added, as in the picker (searchArtistCirclesAction): a
        // lineup is public, so a draft's _id put its name and picture on the event page (L5,
        // draft artist profiles, 2026-11-21). Same answer as a non-artist id.
        if (!artistCircle || !isPeerifyArtistIdentity(artistCircle) || !isCirclePublished(artistCircle)) {
            return { success: false, message: "Selected circle is not an artist profile" };
        }

        const existingIds = event.additionalArtistCircleIds || [];
        if (existingIds.includes(circleId)) {
            return { success: true, message: "Artist already added to this event" };
        }

        const user = await getUserByDid(userDid);
        if (!user) return { success: false, message: "User not found" };

        const success = await updateEventDb(eventId, { additionalArtistCircleIds: [...existingIds, circleId] }, user);
        if (!success) return { success: false, message: "Failed to add artist to event" };

        await notifyAddedAsEventArtist(event, circleId);

        revalidatePath(`/circles/${circleHandle}/events/${eventId}`);
        return { success: true, message: "Artist added to event" };
    } catch (error) {
        console.error("Error adding artist to event:", error);
        return { success: false, message: "Failed to add artist to event" };
    }
}

/**
 * Remove an artist/band circle from an event's lineup (and clears any admin delegation for it).
 * Gated the same as event edits (author or moderator).
 */
export async function removeArtistFromEvent(
    circleHandle: string,
    eventId: string,
    circleId: string,
): Promise<{ success: boolean; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return { success: false, message: "Circle not found" };

        const event = await getEventById(eventId, userDid);
        if (!event) return { success: false, message: "Event not found" };

        const isAuthor = userDid === event.createdBy;
        const canModerate = await isAuthorized(userDid, circle._id as string, features.events.moderate);
        if (!isAuthor && !canModerate) {
            return { success: false, message: "Not authorized to remove artists from this event" };
        }

        const user = await getUserByDid(userDid);
        if (!user) return { success: false, message: "User not found" };

        const success = await updateEventDb(
            eventId,
            {
                additionalArtistCircleIds: (event.additionalArtistCircleIds || []).filter((id) => id !== circleId),
                artistAdminCircleIds: (event.artistAdminCircleIds || []).filter((id) => id !== circleId),
            },
            user,
        );
        if (!success) return { success: false, message: "Failed to remove artist from event" };

        revalidatePath(`/circles/${circleHandle}/events/${eventId}`);
        return { success: true, message: "Artist removed from event" };
    } catch (error) {
        console.error("Error removing artist from event:", error);
        return { success: false, message: "Failed to remove artist from event" };
    }
}

/**
 * Grant/revoke full event edit rights to a listed band's circle admins. Gated the same as event
 * edits (author or moderator) — an existing artist admin cannot delegate admin to another band.
 */
export async function setArtistAdminStatus(
    circleHandle: string,
    eventId: string,
    circleId: string,
    isAdmin: boolean,
): Promise<{ success: boolean; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return { success: false, message: "Circle not found" };

        const event = await getEventById(eventId, userDid);
        if (!event) return { success: false, message: "Event not found" };

        const isAuthor = userDid === event.createdBy;
        const canModerate = await isAuthorized(userDid, circle._id as string, features.events.moderate);
        if (!isAuthor && !canModerate) {
            return { success: false, message: "Not authorized to manage artist admin status for this event" };
        }

        if (!(event.additionalArtistCircleIds || []).includes(circleId)) {
            return { success: false, message: "That circle has not been added as an artist for this event" };
        }

        const existingAdminIds = event.artistAdminCircleIds || [];
        const artistAdminCircleIds = isAdmin
            ? existingAdminIds.includes(circleId)
                ? existingAdminIds
                : [...existingAdminIds, circleId]
            : existingAdminIds.filter((id) => id !== circleId);

        const user = await getUserByDid(userDid);
        if (!user) return { success: false, message: "User not found" };

        const success = await updateEventDb(eventId, { artistAdminCircleIds }, user);
        if (!success) return { success: false, message: "Failed to update artist admin status" };

        revalidatePath(`/circles/${circleHandle}/events/${eventId}`);
        return { success: true, message: isAdmin ? "Band admins granted edit access" : "Band admin access revoked" };
    } catch (error) {
        console.error("Error setting artist admin status:", error);
        return { success: false, message: "Failed to update artist admin status" };
    }
}

/**
 * Let an admin of a listed band remove that band from the event themselves — whether or not it
 * currently has artistAdminCircleIds delegation. Intentionally a separate, narrower permission
 * path from removeArtistFromEvent — does not require canModerate/isAuthor, only admin of the
 * specific band circle being removed.
 */
export async function removeSelfAsEventArtist(
    circleHandle: string,
    eventId: string,
    circleId: string,
): Promise<{ success: boolean; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const event = await getEventById(eventId, userDid);
        if (!event) return { success: false, message: "Event not found" };

        if (!(event.additionalArtistCircleIds || []).includes(circleId)) {
            return { success: false, message: "This circle is not listed as an artist for this event" };
        }

        const isAdminOfCircle = await isCircleAdmin(userDid, circleId);
        if (!isAdminOfCircle) {
            return { success: false, message: "Not authorized to remove this artist" };
        }

        const user = await getUserByDid(userDid);
        if (!user) return { success: false, message: "User not found" };

        const success = await updateEventDb(
            eventId,
            {
                additionalArtistCircleIds: (event.additionalArtistCircleIds || []).filter((id) => id !== circleId),
                artistAdminCircleIds: (event.artistAdminCircleIds || []).filter((id) => id !== circleId),
            },
            user,
        );
        if (!success) return { success: false, message: "Failed to remove artist from event" };

        revalidatePath(`/circles/${circleHandle}/events/${eventId}`);
        return { success: true, message: "Removed band from event" };
    } catch (error) {
        console.error("Error removing self as event artist:", error);
        return { success: false, message: "Failed to remove artist from event" };
    }
}

/**
 * Get the artist/band circles attached to an event, with admin-delegation and current-user-admin
 * status for each, for rendering the band list and its per-band controls.
 */
export async function getEventArtistsAction(
    circleHandle: string,
    eventId: string,
): Promise<{ bands: EventArtistBand[] }> {
    const defaultResult = { bands: [] as EventArtistBand[] };

    try {
        const userDid = await getAuthenticatedUserDid();

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return defaultResult;
        // Unpublished: nothing, as for a missing handle, unless the viewer may open the circle
        // (signed-in viewers' events.view includes "everyone", so it doesn't stop strangers).
        if (!(await canViewerOpenCircle(circle, userDid))) return defaultResult;

        // Logged out: only for an event the public may open, the same public path getEventAction
        // uses (circle's events open to everyone, event open and not private).
        let event: EventDisplay | null = null;
        if (userDid) {
            event = await getEventById(eventId, userDid);
        } else if (await canAnonymousViewCircleEvents(circle)) {
            event = await getPublicEventByIdForCircle(circle._id!.toString(), eventId);
        }
        const artistCircleIds = event?.additionalArtistCircleIds || [];
        if (artistCircleIds.length === 0) return defaultResult;

        // Public list shape: no street, exact pin or private metadata unless the viewer owns that
        // artist circle or is a platform admin. Already shaped: redacting again would drop the pin.
        // An artist unpublished after being added (or added before addArtistToEvent checked) is
        // left out for viewers who couldn't open its page; they'd see a draft's name and picture.
        const artistCircles = (
            await Promise.all(
                (await getCirclesByIds(artistCircleIds, { viewerDid: userDid })).map(async (c) =>
                    (await canViewerOpenCircle(c, userDid)) ? c : null,
                ),
            )
        ).filter((c): c is Circle => c !== null);
        const adminDelegatedIds = event?.artistAdminCircleIds || [];

        const bands = await Promise.all(
            artistCircleIds.map(async (circleId): Promise<EventArtistBand | null> => {
                const artistCircle = artistCircles.find((c) => c._id === circleId);
                if (!artistCircle) return null;

                const currentUserIsAdmin = userDid ? await isCircleAdmin(userDid, circleId) : false;
                return {
                    circle: artistCircle,
                    isAdminDelegated: adminDelegatedIds.includes(circleId),
                    currentUserIsAdmin,
                };
            }),
        );

        return { bands: bands.filter((band): band is EventArtistBand => band !== null) };
    } catch (error) {
        console.error("Error in getEventArtistsAction:", error);
        return defaultResult;
    }
}

/**
 * Search artist-typed circles (bands, artists, DJs, producers) to populate the additional-artist
 * picker in the event form.
 */
export async function searchArtistCirclesAction(
    query: string,
    limit: number = 10,
    eventId?: string,
): Promise<GetCirclesBySearchQueryActionResult> {
    const defaultResult: GetCirclesBySearchQueryActionResult = { circles: [] };

    try {
        // Artist/band/venue-adjacent managed identities can be circleType "circle" (e.g. a band
        // with its own delegated admins) or circleType "user" (a solo artist using their personal
        // account), so search across all circle types and filter by identity afterward — mirrors
        // how map-explorer's search fetches broadly then filters client-side. Drafts are left out:
        // their pages show "not found" to everyone but their own admins. Results are already
        // public-shaped for this viewer (getCirclesBySearchQuery).
        const userDid = await getAuthenticatedUserDid();
        const circles = await getCirclesBySearchQuery(query, limit * 3, undefined, userDid);
        return {
            circles: circles
                .filter((circle) => isPeerifyArtistIdentity(circle) && isCirclePublished(circle))
                .slice(0, limit),
        };
    } catch (error) {
        console.error("Error in searchArtistCirclesAction:", error);
        return defaultResult;
    }
}

/**
 * Change event stage
 */
export async function changeEventStageAction(
    circleHandle: string,
    eventId: string,
    newStage: EventStage,
): Promise<{ success: boolean; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return { success: false, message: "Circle not found" };

        const event = await getEventById(eventId, userDid);
        if (!event) return { success: false, message: "Event not found" };

        const currentStage = event.stage;
        let allowed = false;

        const canReview = await isAuthorized(userDid, circle._id as string, features.events.review);
        const canModerate = await isAuthorized(userDid, circle._id as string, features.events.moderate);

        if (canModerate) {
            allowed = true;
        } else if (currentStage === "draft" && newStage === "review") {
            // Author can submit for review; reviewers can also move directly to review if needed
            allowed = userDid === event.createdBy || canReview;
        } else if ((currentStage === "draft" || currentStage === "review") && newStage === "open") {
            // Reviewers can open directly from draft, or after review
            allowed = canReview;
        } else if (currentStage === "open" && newStage === "cancelled") {
            // allow review or moderate to cancel
            allowed = canReview;
        }

        if (!allowed) {
            return { success: false, message: `Not authorized to move event from ${currentStage} to ${newStage}` };
        }

        const success = await changeEventStageDb(eventId, newStage);
        if (!success) return { success: false, message: "Failed to change event stage" };

        // Send notifications based on transition
        try {
            const actor = await getUserByDid(userDid);
            if (actor) {
                if (currentStage === "draft" && newStage === "review") {
                    await notifyEventSubmittedForReview(
                        { _id: event._id!, title: event.title, circleId: event.circleId },
                        actor,
                    );
                } else if ((currentStage === "draft" || currentStage === "review") && newStage === "open") {
                    await notifyEventApproved(
                        { _id: event._id!, title: event.title, circleId: event.circleId, createdBy: event.createdBy },
                        actor,
                    );
                } else {
                    await notifyEventStatusChanged(
                        {
                            _id: event._id!,
                            title: event.title,
                            circleId: event.circleId,
                            createdBy: event.createdBy,
                            stage: newStage,
                        },
                        actor,
                        currentStage,
                    );
                }
            }
        } catch (notifyErr) {
            console.error("Error sending event stage change notifications:", notifyErr);
        }

        // Create/sync the linked Noticeboard post now that the event is actually open. This is
        // the only place a draft/review event's post ever gets created — createEventAction and
        // updateEventAction only persist the host's intent (publishToNoticeboard) while the event
        // isn't open yet, so a draft event never has a live, publicly-visible Noticeboard post.
        if (newStage === "open" && event.publishToNoticeboard) {
            try {
                const noticeboardPostId = await upsertEventNoticeboardPost({
                    circle,
                    circleHandle,
                    event,
                });
                if (noticeboardPostId && noticeboardPostId !== event.noticeboardPostId) {
                    await Events.updateOne({ _id: new ObjectId(eventId) }, { $set: { noticeboardPostId } });
                }
                revalidatePath(`/circles/${circleHandle}/feed`);
            } catch (error) {
                console.error("Failed to create linked noticeboard post for event on open:", error);
            }
        }

        revalidatePath(`/circles/${circleHandle}/events`);
        revalidatePath(`/circles/${circleHandle}/events/${eventId}`);

        return { success: true, message: `Event stage changed to ${newStage}` };
    } catch (error) {
        console.error("Error changing event stage:", error);
        return { success: false, message: "Failed to change event stage" };
    }
}

/**
 * RSVP - going / interested / waitlist
 */
export async function rsvpEventAction(
    circleHandle: string,
    eventId: string,
    status: "going" | "interested" | "waitlist",
): Promise<{ success: boolean; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const user = await getUserByDid(userDid);
        if (!user) return { success: false, message: "User not found" };

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return { success: false, message: "Circle not found" };

        const canRsvp = await isAuthorized(userDid, circle._id as string, features.events.rsvp);
        if (!canRsvp) return { success: false, message: "Not authorized to RSVP" };

        const refusal = await getEventRsvpRefusal(await getEventById(eventId, userDid), String(circle._id), userDid);
        if (refusal) return { success: false, message: refusal };
        // D4: a confirmed guest can't switch to Interested themselves (Attend again is fine).
        if (status !== "going" && (await isConfirmedGuest(eventId, userDid))) {
            return { success: false, message: CONFIRMED_GUEST_CANT_CHANGE };
        }

        const ok = await upsertRsvp(eventId, circle._id!.toString(), userDid, status);
        if (!ok) return { success: false, message: "Failed to RSVP" };

        revalidatePath(`/circles/${circleHandle}/events`);
        revalidatePath(`/circles/${circleHandle}/events/${eventId}`);
        return { success: true, message: "RSVP updated" };
    } catch (error) {
        console.error("Error RSVPing:", error);
        return { success: false, message: "Failed to RSVP" };
    }
}

/**
 * Cancel RSVP
 */
export async function cancelRsvpAction(
    circleHandle: string,
    eventId: string,
): Promise<{ success: boolean; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return { success: false, message: "Circle not found" };

        const canRsvp = await isAuthorized(userDid, circle._id as string, features.events.rsvp);
        if (!canRsvp) return { success: false, message: "Not authorized to RSVP" };

        // Only an event of the circle in the URL (G1). Withdrawing needs nothing more: it removes the
        // viewer's own RSVP, even on an event that has since gone back to draft or been cancelled.
        const event = await getEventById(eventId, userDid);
        if (!event || String(event.circleId) !== String(circle._id)) {
            return { success: false, message: RSVP_EVENT_NOT_FOUND };
        }

        // D4: a confirmed guest (often paid) can't cancel themselves: an organiser undoes the
        // confirmation first.
        if (await isConfirmedGuest(eventId, userDid)) return { success: false, message: CONFIRMED_GUEST_CANT_CHANGE };

        const ok = await cancelRsvp(eventId, userDid);
        if (!ok) return { success: false, message: "Failed to cancel RSVP" };

        revalidatePath(`/circles/${circleHandle}/events`);
        revalidatePath(`/circles/${circleHandle}/events/${eventId}`);
        return { success: true, message: "RSVP cancelled" };
    } catch (error) {
        console.error("Error cancelling RSVP:", error);
        return { success: false, message: "Failed to cancel RSVP" };
    }
}

/**
 * Ensure shadow post exists for comments on an event (fallback).
 * Note: createEvent in data layer already attempts this. This is a utility for idempotency.
 */
export async function ensureShadowPostForEventAction(eventId: string, circleId: string): Promise<string | null> {
    try {
        if (!ObjectId.isValid(eventId) || !ObjectId.isValid(circleId)) {
            console.error("Invalid eventId or circleId provided to ensureShadowPostForEventAction");
            return null;
        }

        const event = await Events.findOne({ _id: new ObjectId(eventId) });
        if (!event) {
            console.error(`Event not found: ${eventId}`);
            return null;
        }
        if (event.commentPostId) return event.commentPostId;

        const feed = await Feeds.findOne({ circleId });
        if (!feed) {
            console.warn(`No feed found for circle ${circleId} to create shadow post for event ${eventId}.`);
            return null;
        }

        // defer to feed.createPost to ensure consistency
        const { createPost } = await import("@/lib/data/feed");
        const shadowPost = await createPost({
            feedId: feed._id.toString(),
            createdBy: event.createdBy,
            createdAt: new Date(),
            content: `Event: ${event.title}`,
            postType: "event",
            parentItemId: event._id.toString(),
            parentItemType: "event",
            userGroups: event.userGroups || [],
            comments: 0,
            reactions: {},
        });

        if (shadowPost && shadowPost._id) {
            const commentPostIdString = shadowPost._id.toString();
            const updateResult = await Events.updateOne(
                { _id: event._id },
                { $set: { commentPostId: commentPostIdString } },
            );
            if (updateResult.modifiedCount === 1) {
                return commentPostIdString;
            }
        }
        return null;
    } catch (error) {
        console.error(`Error in ensureShadowPostForEventAction for event ${eventId}:`, error);
        return null;
    }
}

/**
 * Invite users to an event
 */
// Who may invite people to an event: the same rule as editing it (updateEventAction): its creator,
// anyone with events.moderate on the hosting circle, or an admin of one of the event's artist
// circles. The invite picker's follower rows follow it too (getCircleMembersAction).
async function mayInviteToEvent(
    userDid: string,
    circle: Circle,
    event: { createdBy?: string; artistAdminCircleIds?: string[] },
): Promise<boolean> {
    if (userDid === event.createdBy) return true;
    if (await isAuthorized(userDid, circle._id as string, features.events.moderate)) return true;
    return await isCircleAdminOfAny(userDid, event.artistAdminCircleIds);
}

// The invite picker lists a circle's followers. Since 2026-11-07 follower rows are for the circle's
// admins and moderators (canViewFollowerList), and for someone who may invite people to the event
// the picker is open for, so inviting keeps working for event creators and artist admins.
async function mayListInviteCandidates(userDid: string, circle: Circle, eventId?: string): Promise<boolean> {
    if (await canViewFollowerList(circle, userDid)) return true;
    if (!eventId || !ObjectId.isValid(eventId)) return false;
    const event = await getEventById(eventId, userDid);
    if (!event || event.circleId !== String(circle._id)) return false;
    return await mayInviteToEvent(userDid, circle, event);
}

export async function inviteUsersToEventAction(
    circleHandle: string,
    eventId: string,
    userDids: string[],
): Promise<{ success: boolean; message?: string; invitation?: InviteUsersToEventResult }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const user = await getUserByDid(userDid);
        if (!user) return { success: false, message: "User not found" };

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return { success: false, message: "Circle not found" };

        const event = await getEventById(eventId, userDid);
        if (!event || event.circleId !== String(circle._id)) return { success: false, message: "Event not found" };

        if (!(await mayInviteToEvent(userDid, circle, event))) {
            return { success: false, message: "Only people who can edit this event can invite others to it." };
        }

        const invitation = await inviteUsersToEvent(eventId, circle._id!.toString(), userDids, user);

        revalidatePath(`/circles/${circleHandle}/events/${eventId}`);
        return { success: true, message: "Invitations sent", invitation };
    } catch (error) {
        console.error("Error inviting users to event:", error);
        return { success: false, message: "Failed to send invitations" };
    }
}

// Attendee and invitee lists (Tim, 2026-10-20): the list's own people see everyone; anyone else who
// may view the event sees only their own entry. Guests (who RSVPed) go to canSeeEventGuests (D1,
// 2026-11-20: the creator, platform admins and "See and manage guests" on the event's circle, admins
// and moderators by default); invitees to the event's managers (canManageEvent), who may invite.
// null = the event doesn't exist for this viewer or belongs to another circle than the one in the URL.
const getAttendeeListScope = async (
    circle: Circle,
    eventId: string,
    userDid: string,
    list: "guests" | "invitees",
): Promise<"all" | "self" | null> => {
    const event = await getEventById(eventId, userDid);
    if (!event || event.circleId !== String(circle._id)) return null;
    const seesAll =
        list === "guests" ? await canSeeEventGuests(event, userDid) : await canManageEvent(event, userDid);
    return seesAll ? "all" : "self";
};

export type EventGuestsResult = {
    // True for the event's organisers (canSeeEventGuests): `guests` is everyone who clicked Attend or
    // Interested. Anyone else gets only their own entry, if any.
    canSeeGuests: boolean;
    // The circle's access rules give this viewer "See and manage guests", but their profile isn't
    // verified yet (that right needs one). The page says so where the list would be.
    needsProfileToSeeGuests: boolean;
    guests: (EventGuest & { confirmed: boolean })[];
    // Organisers only: the event's capacity (none = no limit) and how many guests are confirmed.
    capacity?: number;
    confirmedCount?: number;
    // Organisers only, with a capacity: places taken outside Peerify (2026-11-22), and whether the
    // event is ticketed (for "tickets left" / "Sold out" rather than places / Full).
    placesTakenOutside?: number;
    ticketed?: boolean;
};

/**
 * An event's guest list (event guests, part 1, 2026-11-20): Attend and Interested, with each
 * person's message to the organisers and when they replied. Organisers only; everyone else gets
 * their own entry. Nothing for a signed-out viewer, a viewer who may not view the circle's events,
 * or an event of another circle than the one in the URL.
 */
export async function getEventGuestsAction(circleHandle: string, eventId: string): Promise<EventGuestsResult> {
    const nothing: EventGuestsResult = { canSeeGuests: false, needsProfileToSeeGuests: false, guests: [] };
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return nothing;

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return nothing;

        const canView = await isAuthorized(userDid, circle._id as string, features.events.view);
        if (!canView) return nothing;

        const scope = await getAttendeeListScope(circle, eventId, userDid, "guests");
        if (!scope) return nothing;

        const [listed, confirmedDids] = await Promise.all([listEventGuests(eventId), getConfirmedGuestDids(eventId)]);
        const guests = listed.map((guest) => ({ ...guest, confirmed: confirmedDids.has(guest.user.did!) }));
        if (scope === "all") {
            const event = await getEventById(eventId, userDid);
            return {
                canSeeGuests: true,
                needsProfileToSeeGuests: false,
                guests,
                ...(typeof event?.capacity === "number"
                    ? {
                          capacity: event.capacity,
                          placesTakenOutside: getPlacesTakenOutside(event),
                          ticketed:
                              (event.metadata as { peerify?: { ticketed?: boolean } } | undefined)?.peerify
                                  ?.ticketed === true,
                      }
                    : {}),
                confirmedCount: confirmedDids.size,
            };
        }
        return {
            canSeeGuests: false,
            needsProfileToSeeGuests: await isBlockedOnlyByVerification(
                userDid,
                String(circle._id),
                features.events.guests,
            ),
            guests: guests.filter((guest) => guest.user.did === userDid),
        };
    } catch (error) {
        console.error("Error in getEventGuestsAction:", error);
        return nothing;
    }
}

export type EventGuestDetails = {
    // The viewer is a confirmed guest of this event.
    isConfirmed: boolean;
    // The note for confirmed guests: to confirmed guests and the event's organisers only.
    guestNote?: string;
    // D7: the exact location, for a confirmed guest of an event whose address is "revealed after
    // acceptance". Organisers already have it on the event.
    location?: Location;
    // The viewer clicked Attend and isn't confirmed yet, and there's something for confirmed guests
    // (a note, or a hidden address): the page says "Details for guests appear once you're confirmed."
    detailsAfterConfirmation: boolean;
};

/**
 * What the event page shows a viewer about being a guest (event guests, part 2, 2026-11-20): whether
 * they're confirmed, and the guest note and hidden address when they may have them (decision B, as
 * on shifts: confirmed guests and organisers only). Nothing for a signed-out viewer, an event they
 * may not see, or an event of another circle than the one in the URL.
 */
export async function getEventGuestDetailsAction(circleHandle: string, eventId: string): Promise<EventGuestDetails> {
    const nothing: EventGuestDetails = { isConfirmed: false, detailsAfterConfirmation: false };
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return nothing;
        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return nothing;
        const event = await getEventById(eventId, userDid);
        if (!event || String(event.circleId) !== String(circle._id)) return nothing;

        const isOrganiser = (await canSeeEventGuests(event, userDid)) || (await canManageEvent(event, userDid));
        if (!isOrganiser && !(await shapeEventForViewer(event, userDid))) return nothing;

        const baseEventId = String(eventId).split("_")[0];
        if (!ObjectId.isValid(baseEventId)) return nothing;
        const stored = (await Events.findOne(
            { _id: new ObjectId(baseEventId) },
            { projection: { guestConfirmations: 1, location: 1, metadata: 1, createdBy: 1, circleId: 1 } },
        )) as EventModel | null;
        if (!stored) return nothing;

        const guestNote = stored.metadata?.peerify?.guestNote?.trim() || undefined;
        const addressHidden = stored.metadata?.peerify?.locationDisclosure === "secret_after_acceptance";
        if (isOrganiser) return { isConfirmed: false, detailsAfterConfirmation: false, ...(guestNote ? { guestNote } : {}) };

        const isConfirmed =
            !String(eventId).includes("_") &&
            (stored.guestConfirmations ?? []).some((confirmation) => confirmation.userDid === userDid);
        if (isConfirmed) {
            return {
                isConfirmed: true,
                detailsAfterConfirmation: false,
                ...(guestNote ? { guestNote } : {}),
                ...(addressHidden && stored.location ? { location: stored.location } : {}),
            };
        }
        const isGoing = !!(await EventRsvps.findOne({ eventId: String(eventId), userDid, status: "going" }));
        return { isConfirmed: false, detailsAfterConfirmation: isGoing && (!!guestNote || addressHidden) };
    } catch (error) {
        console.error("Error in getEventGuestDetailsAction:", error);
        return nothing;
    }
}

/**
 * "Message the organisers" in a confirmed guest's RSVP box (2026-11-21): opens the guest's DM with
 * the organiser who confirmed them (or the event's creator), creating it only now. The rules are in
 * openConversationWithOrganisers. Returns the conversation id to open.
 */
export async function messageEventOrganisersAction(
    circleHandle: string,
    eventId: string,
): Promise<{ success: boolean; conversationId?: string; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };
        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return { success: false, message: "Circle not found" };
        const event = await getEventById(eventId, userDid);
        if (!event || String(event.circleId) !== String(circle._id) || !(await shapeEventForViewer(event, userDid))) {
            return { success: false, message: ONLY_CONFIRMED_GUESTS_MESSAGE };
        }
        const result = await openConversationWithOrganisers(userDid, String(circle._id), eventId);
        return result.ok
            ? { success: true, conversationId: result.conversationId }
            : { success: false, message: result.message };
    } catch (error) {
        console.error("Error in messageEventOrganisersAction:", error);
        return { success: false, message: "Could not open the conversation" };
    }
}

// The event, if the signed-in viewer is one of its organisers (canSeeEventGuests) and it belongs to the
// circle in the URL.
const loadEventForOrganiser = async (
    circleHandle: string,
    eventId: string,
): Promise<{ ok: true; userDid: string; circle: Circle; event: EventDisplay } | { ok: false; message: string }> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) return { ok: false, message: "User not authenticated" };
    const circle = await getCircleByHandle(circleHandle);
    if (!circle) return { ok: false, message: "Circle not found" };
    const event = await getEventById(eventId, userDid);
    if (!event || String(event.circleId) !== String(circle._id)) return { ok: false, message: "Event not found" };
    if (!(await canSeeEventGuests(event, userDid))) {
        return { ok: false, message: "Only the event's organisers can confirm guests" };
    }
    return { ok: true, userDid, circle, event };
};

/**
 * Mark someone who clicked Attend as a confirmed guest (event guests, part 2): organisers only.
 * Confirmed guests plus places taken outside Peerify never exceed the event's capacity ("No places left").
 */
export async function confirmEventGuestAction(
    circleHandle: string,
    eventId: string,
    guestDid: string,
): Promise<{ success: boolean; message?: string }> {
    try {
        const loaded = await loadEventForOrganiser(circleHandle, eventId);
        if (!loaded.ok) return { success: false, message: loaded.message };

        const result = await confirmEventGuest(eventId, guestDid, loaded.userDid);
        if (!result.ok) return { success: false, message: result.message };

        // D3: tell the guest (bell only), once.
        if (!result.alreadyConfirmed) {
            const guest = await getUserPrivate(guestDid);
            if (guest) {
                await notifyEventGuestConfirmed(
                    { _id: eventId, title: loaded.event.title, circleId: String(loaded.circle._id) },
                    guest,
                );
            }
        }

        revalidatePath(`/circles/${circleHandle}/events/${eventId}`);
        return { success: true, message: result.alreadyConfirmed ? "Already confirmed" : "Guest confirmed" };
    } catch (error) {
        console.error("Error confirming event guest:", error);
        return { success: false, message: "Failed to confirm the guest" };
    }
}

/** Take back a confirmation (organisers only). The person stays on the list as Attending. */
export async function unconfirmEventGuestAction(
    circleHandle: string,
    eventId: string,
    guestDid: string,
): Promise<{ success: boolean; message?: string }> {
    try {
        const loaded = await loadEventForOrganiser(circleHandle, eventId);
        if (!loaded.ok) return { success: false, message: loaded.message };

        if (!(await unconfirmEventGuest(eventId, guestDid))) {
            return { success: false, message: "Failed to undo the confirmation" };
        }
        revalidatePath(`/circles/${circleHandle}/events/${eventId}`);
        return { success: true, message: "Confirmation undone" };
    } catch (error) {
        console.error("Error unconfirming event guest:", error);
        return { success: false, message: "Failed to undo the confirmation" };
    }
}

/**
 * Get invited users for an event
 */
export async function getInvitedUsersAction(
    circleHandle: string,
    eventId: string,
): Promise<GetInvitedUsersActionResult> {
    const defaultResult: GetInvitedUsersActionResult = { users: [] };

    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return defaultResult;

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return defaultResult;

        const canView = await isAuthorized(userDid, circle._id as string, features.events.view);
        if (!canView) return defaultResult;

        // Leak round 3, H3 (2026-11-05): the event must be one this viewer can open and must belong
        // to the URL circle; only its managers see who is invited, anyone else only themselves.
        const scope = await getAttendeeListScope(circle, eventId, userDid, "invitees");
        if (!scope) return defaultResult;

        // Invitations are stored in EventInvitations collection (not on the event document)
        const invitations = await EventInvitations.find({ eventId }).toArray();
        const invitedDids = Array.from(new Set(invitations.map((inv: any) => inv.userDid).filter(Boolean))).filter(
            (did) => scope === "all" || did === userDid,
        );
        if (invitedDids.length === 0) return defaultResult;

        const users = await getCirclesByDids(invitedDids, { viewerDid: userDid });
        return { users };
    } catch (error) {
        console.error("Error in getInvitedUsersAction:", error);
        return defaultResult;
    }
}

/**
 * RSVP with options (isPublic + message)
 */
export async function rsvpEventWithOptionsAction(
    circleHandle: string,
    eventId: string,
    status: "going" | "interested" | "waitlist",
    options?: { isPublic?: boolean; message?: string },
): Promise<{ success: boolean; message?: string }> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return { success: false, message: "User not authenticated" };

        const user = await getUserByDid(userDid);
        if (!user) return { success: false, message: "User not found" };

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return { success: false, message: "Circle not found" };

        const canRsvp = await isAuthorized(userDid, circle._id as string, features.events.rsvp);
        if (!canRsvp) return { success: false, message: "Not authorized to RSVP" };

        const refusal = await getEventRsvpRefusal(await getEventById(eventId, userDid), String(circle._id), userDid);
        if (refusal) return { success: false, message: refusal };
        // D4: a confirmed guest can't switch to Interested themselves (Attend again is fine).
        if (status !== "going" && (await isConfirmedGuest(eventId, userDid))) {
            return { success: false, message: CONFIRMED_GUEST_CANT_CHANGE };
        }

        const ok = await upsertRsvp(
            eventId,
            circle._id!.toString(),
            userDid,
            status,
            undefined,
            options?.isPublic,
            options?.message,
        );
        if (!ok) return { success: false, message: "Failed to RSVP" };

        revalidatePath(`/circles/${circleHandle}/events`);
        revalidatePath(`/circles/${circleHandle}/events/${eventId}`);
        return { success: true, message: "RSVP updated" };
    } catch (error) {
        console.error("Error RSVPing with options:", error);
        return { success: false, message: "Failed to RSVP" };
    }
}

/**
 * Cancel RSVP
 */
export async function getCircleMembersAction(
    circleHandle: string,
    eventId?: string,
): Promise<GetCircleMembersActionResult> {
    const defaultResult: GetCircleMembersActionResult = { members: [] };

    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return defaultResult;

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return defaultResult;

        const canView = await isAuthorized(userDid, circle._id as string, features.events.view);
        if (!canView) return defaultResult;

        if (circle.circleType === "user") {
            return {
                members: await listAcceptedConnectionsForUserDid(userDid),
            };
        }

        // The invite picker lists the circle's followers: only for the circle's admins and
        // moderators, or someone who may invite people to this event (2026-11-07).
        if (!(await mayListInviteCandidates(userDid, circle, eventId))) return defaultResult;

        const members = await getMembers(circle._id!.toString());
        const memberDids = members.map((m) => m.userDid);
        const users = await getCirclesByDids(memberDids, { viewerDid: userDid });

        // Filter to only users who themselves have permission to view events in this circle
        const eligibilityChecks = await Promise.all(
            users.map((u) =>
                u.did ? isAuthorized(u.did, circle._id as string, features.events.view) : Promise.resolve(false),
            ),
        );
        const eligibleUsers = users.filter((_, idx) => eligibilityChecks[idx]);

        return { members: eligibleUsers };
    } catch (error) {
        console.error("Error in getCircleMembersAction:", error);
        return defaultResult;
    }
}

/**
/**
 * Add a comment to an event (via its shadow post)
 */
export async function addEventCommentAction(eventId: string, data: Partial<Comment>) {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) throw new Error("Unauthorized");

    const user = await getUserByDid(userDid);
    if (!user) throw new Error("User not found");

    const event = await getEventById(eventId, userDid);
    if (!event) throw new Error("Event not found");

    if (!event.commentPostId) {
        throw new Error("Event has no comment post");
    }

    const canComment = await isAuthorized(userDid, event.circleId, features.feed.comment);
    if (!canComment) throw new Error("Not authorized to comment");

    return addCommentToDiscussion(event.commentPostId, {
        ...data,
        createdBy: userDid,
    });
}

/**
 * Get event with comments (via its shadow post)
 */
export async function getEventWithCommentsAction(eventId: string) {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) throw new Error("Event not found");
    const found = await getEventById(eventId, userDid);
    if (!found || !(await isAuthorized(userDid, found.circleId, features.events.view))) {
        throw new Error("Event not found");
    }
    const event = await shapeEventForViewer(found, userDid);
    if (!event) throw new Error("Event not found");
    if (!event.commentPostId) return { ...event, comments: [] };

    // Same read, gate and author shaping as the event page's CommentSection (login + view access,
    // identity-only authors). Never the raw comment documents: their stored author snapshot holds
    // older authors' email and other private fields.
    const result = await getAllCommentsAction(event.commentPostId);
    return { ...event, comments: result.success ? (result.comments ?? []) : [] };
}

/**
 * Lightweight lookup for the event creation form: read just circle.defaultEventTags (not the
 * whole Circle) so the tag picker can be pre-filled with the host circle's defaults before the
 * event is even saved. Only needed when the form doesn't already have a full Circle object on
 * hand from CircleSelector (see handleCircleSelected in event-form.tsx, which reads
 * defaultEventTags directly off the Circle it's already given).
 */
export async function getCircleDefaultEventTagsAction(circleHandle: string): Promise<EventTagsValue | undefined> {
    try {
        const circle = await getCircleByHandle(circleHandle);
        // Only Venue circles have a meaningful circle-level default (see
        // about-settings-form.tsx) — every other circle type prefills nothing.
        if (!isPeerifyVenueIdentity(circle)) return undefined;
        // Run through normalizeEventTags rather than returned raw — an unset category on an
        // already-saved circle can come back from MongoDB as a literal null value (see
        // normalizeEventTags's own comment), which this action's callers would otherwise carry
        // straight into the create form's tags state.
        return normalizeEventTags(circle?.defaultEventTags);
    } catch (error) {
        console.error("Error in getCircleDefaultEventTagsAction:", error);
        return undefined;
    }
}

/**
 * Get circles by search query
 */
export async function getCirclesBySearchQueryAction(
    query: string,
    limit: number = 10,
    circleType?: CircleType,
): Promise<GetCirclesBySearchQueryActionResult> {
    const defaultResult: GetCirclesBySearchQueryActionResult = { circles: [] };

    try {
        // Only the signed-in global-create picker uses this; it searches every circle by name.
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return defaultResult;

        const circles = await getCirclesBySearchQuery(query, limit, circleType, userDid);
        return { circles };
    } catch (error) {
        console.error("Error in getCirclesBySearchQueryAction:", error);
        return defaultResult;
    }
}

/**
 * Search users and return only those eligible to view events in the circle (for invites).
 */
export async function searchEligibleUsersAction(
    circleHandle: string,
    query: string,
    limit: number = 10,
    eventId?: string,
): Promise<GetCirclesBySearchQueryActionResult> {
    const defaultResult: GetCirclesBySearchQueryActionResult = { circles: [] };

    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) return defaultResult;

        const circle = await getCircleByHandle(circleHandle);
        if (!circle) return defaultResult;

        // Ensure current user can view events in this circle
        const canView = await isAuthorized(userDid, circle._id as string, features.events.view);
        if (!canView) return defaultResult;

        if (circle.circleType === "user") {
            const circles = await searchAcceptedConnectionsForUserDid(userDid, query, limit);
            return { circles };
        }

        // The eligibility filter below tells who may view this circle's events, which can be its
        // followers: same rule as the picker's list (getCircleMembersAction).
        if (!(await mayListInviteCandidates(userDid, circle, eventId))) return defaultResult;

        const { circles } = await getCirclesBySearchQueryAction(query, limit, "user");

        // Filter search results to only users who themselves have permission to view events in this circle
        const eligibilityChecks = await Promise.all(
            circles.map((c) =>
                c.did ? isAuthorized(c.did, circle._id as string, features.events.view) : Promise.resolve(false),
            ),
        );
        const eligible = circles.filter((_, idx) => eligibilityChecks[idx]);

        return { circles: eligible };
    } catch (error) {
        console.error("Error in searchEligibleUsersAction:", error);
        return defaultResult;
    }
}

/**
 * Hide a cancelled event from the current user's timelines and calendars.
 */
export async function hideCancelledEventAction(
    circleHandle: string,
    eventId: string,
): Promise<HideCancelledEventResult> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) {
            return { success: false, message: "Not authenticated" };
        }

        if (!ObjectId.isValid(eventId)) {
            return { success: false, message: "Invalid event ID" };
        }

        const [event, user] = await Promise.all([getEventById(eventId, userDid), getPrivateUserByDid(userDid)]);

        if (!event) {
            return { success: false, message: "Event not found" };
        }

        if (!user || !user._id) {
            return { success: false, message: "User not found" };
        }

        const canView = await isAuthorized(userDid, event.circleId, features.events.view);
        if (!canView) {
            return { success: false, message: "Not authorized" };
        }

        if (event.circle?.handle && event.circle.handle !== circleHandle) {
            return { success: false, message: "Event does not belong to this circle" };
        }

        if (event.stage !== "cancelled") {
            return { success: false, message: "Only cancelled events can be hidden" };
        }

        const hidden = user.hiddenCancelledEventIds || [];
        if (hidden.includes(eventId)) {
            return { success: true, message: "Event already hidden" };
        }

        const updatedHidden = [...hidden, eventId];
        await updateUser({ _id: user._id, hiddenCancelledEventIds: updatedHidden }, userDid);

        return { success: true };
    } catch (error) {
        console.error("Error in hideCancelledEventAction:", error);
        return { success: false, message: "Failed to hide event" };
    }
}

/**
 * Remove a cancelled event from the user's hidden list.
 */
export async function unhideCancelledEventAction(
    circleHandle: string,
    eventId: string,
): Promise<HideCancelledEventResult> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) {
            return { success: false, message: "Not authenticated" };
        }

        if (!ObjectId.isValid(eventId)) {
            return { success: false, message: "Invalid event ID" };
        }

        const [event, user] = await Promise.all([getEventById(eventId, userDid), getPrivateUserByDid(userDid)]);

        if (!event) {
            return { success: false, message: "Event not found" };
        }

        if (!user || !user._id) {
            return { success: false, message: "User not found" };
        }

        const canView = await isAuthorized(userDid, event.circleId, features.events.view);
        if (!canView) {
            return { success: false, message: "Not authorized" };
        }

        if (event.circle?.handle && event.circle.handle !== circleHandle) {
            return { success: false, message: "Event does not belong to this circle" };
        }

        const hidden = user.hiddenCancelledEventIds || [];
        if (!hidden.includes(eventId)) {
            return { success: true, message: "Event is not hidden" };
        }

        const updatedHidden = hidden.filter((id) => id !== eventId);
        await updateUser({ _id: user._id, hiddenCancelledEventIds: updatedHidden }, userDid);

        return { success: true };
    } catch (error) {
        console.error("Error in unhideCancelledEventAction:", error);
        return { success: false, message: "Failed to unhide event" };
    }
}
