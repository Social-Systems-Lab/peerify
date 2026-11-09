// Pure: no database, no I/O. Lives here (not in notifications.ts, which creates indexes when it is
// imported) so scripts/cleanup-comment-authors.ts can shape stored notifications the same way.
import type { Circle } from "@/models/models";
import { toIdentityCircle } from "../utils/public-circle";

// --- Notification content shape (leak round 3, 2026-11-05) -----------------------------------
// Notification payloads used to carry whole circle/user documents (getCircleById, getUser,
// getUserPrivate), and /api/notifications sent them to the recipient's browser: other people's
// exact location, email, memberships, venue contacts. Content is now reduced to what the bell
// renders, both when a notification is stored and when stored ones are read (old documents keep
// the full records until they are cleaned up).
//  - any object with a `did` (a person or a personal profile) -> toIdentityCircle: _id, did, handle,
//    name, picture, circleType
//  - the keys that hold a circle or a person (NOTIFICATION_IDENTITY_KEYS) -> toIdentityCircle too,
//    with or without a `did`. Artist, venue and other circles have no `did` (createCircle never
//    sets one); the bell builds its links and buttons from circle.handle, and account erasure
//    matches on content.circle._id. Until 2026-11-06 these circles were dropped whole.
//  - the few other objects notifications embed -> the fields listed below. Kept on purpose:
//    everything the bell reads (post.postType/parentItemType/parentItemId) and everything account
//    erasure matches on (content.post.createdBy, content.comment.createdBy, content.*._id).
//  - any other object is dropped. Strings, numbers, booleans, dates, ids and arrays of those pass.
const NOTIFICATION_OBJECT_FIELDS: Record<string, readonly string[]> = {
    post: ["_id", "createdBy", "feedId", "postType", "parentItemType", "parentItemId"],
    comment: ["_id", "postId", "createdBy", "parentCommentId"],
    event: ["_id", "title", "circleId", "startAt", "endAt"],
    task: ["_id", "title", "stage", "circleId"],
    issue: ["_id", "title", "stage", "circleId"],
    goal: ["_id", "title", "stage", "circleId"],
    proposal: ["_id", "name", "stage", "circleId"],
    project: ["_id", "name", "handle", "circleId"],
};

// The payload keys sendNotifications callers use for a circle or a person.
const NOTIFICATION_IDENTITY_KEYS = new Set(["circle", "user", "artistCircle", "targetParentCircle", "subject"]);

// A value with no fields of its own to leak: primitives, dates and BSON values (ObjectId).
const isScalar = (value: unknown): boolean =>
    value === null ||
    typeof value !== "object" ||
    value instanceof Date ||
    "_bsontype" in (value as object);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value) && !isScalar(value);

const shapeNotificationValue = (key: string, value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value
            .map((item) => (isScalar(item) ? item : shapeNotificationValue(key, item)))
            .filter((item) => item !== undefined);
    }
    if (!isRecord(value)) {
        return value;
    }
    if (typeof value.did === "string" || NOTIFICATION_IDENTITY_KEYS.has(key)) {
        return toIdentityCircle(value as Circle);
    }
    const fields = NOTIFICATION_OBJECT_FIELDS[key];
    if (!fields) {
        return undefined;
    }
    const picked: Record<string, unknown> = {};
    for (const field of fields) {
        const fieldValue = value[field];
        if (fieldValue !== undefined && isScalar(fieldValue)) {
            picked[field] = field === "_id" && fieldValue !== null ? String(fieldValue) : fieldValue;
        }
    }
    return picked;
};

export function shapeNotificationContent<T>(content: T): T {
    if (!isRecord(content)) {
        return content;
    }
    const shaped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(content)) {
        const next = shapeNotificationValue(key, value);
        if (next !== undefined) {
            shaped[key] = next;
        }
    }
    return shaped as T;
}
