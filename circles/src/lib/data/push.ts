// src/lib/data/push.ts - Web push delivery, fired synchronously from sendNotifications
import webpush from "web-push";
import { PushSubscriptions, Circles } from "./db";
import { NotificationType, PushSubscriptionDoc } from "@/models/models";
import { getCircleDefaultPath } from "@/lib/utils/circle-routes";

export type PushCategory = "messages" | "events" | "verification" | "community";

// Extending this list to a new category later is just one more entry here plus one more
// optional boolean on circleSchema (see pushMessages/pushEvents/... in models.ts) - no migration.
export const PUSH_NOTIFICATION_CATEGORIES: Record<
    PushCategory,
    { preferenceKey: "pushMessages" | "pushEvents" | "pushVerification" | "pushCommunity"; defaultEnabled: boolean; notificationTypes: NotificationType[] }
> = {
    messages: {
        preferenceKey: "pushMessages",
        defaultEnabled: true,
        notificationTypes: ["pm_received", "contact_request_received", "contact_request_accepted"],
    },
    events: {
        preferenceKey: "pushEvents",
        defaultEnabled: true,
        notificationTypes: [
            "event_invitation",
            "event_artist_added",
            "event_host_change_requested",
            "event_host_change_decided",
        ],
    },
    verification: {
        preferenceKey: "pushVerification",
        defaultEnabled: true,
        notificationTypes: [
            "user_verified",
            "user_verification_request",
            "user_verification_clarification_requested",
            "user_verification_reply_received",
            "user_verification_rejected",
            "proof_of_humanity_verified",
        ],
    },
    community: {
        preferenceKey: "pushCommunity",
        defaultEnabled: false,
        notificationTypes: ["follow_request", "new_follower", "follow_accepted"],
    },
};

const typeToCategory = new Map<NotificationType, PushCategory>();
for (const [category, config] of Object.entries(PUSH_NOTIFICATION_CATEGORIES) as [PushCategory, (typeof PUSH_NOTIFICATION_CATEGORIES)[PushCategory]][]) {
    for (const type of config.notificationTypes) {
        typeToCategory.set(type, category);
    }
}

export const getPushCategoryForType = (type: string): PushCategory | null => {
    return typeToCategory.get(type as NotificationType) || null;
};

export const isPushEnabledForRecipient = async (type: string, recipientDid: string): Promise<boolean> => {
    const category = getPushCategoryForType(type);
    if (!category) {
        return false;
    }

    const config = PUSH_NOTIFICATION_CATEGORIES[category];
    const user = await Circles.findOne(
        { did: recipientDid, circleType: "user" },
        { projection: { [config.preferenceKey]: 1 } },
    );
    const preference = (user as any)?.[config.preferenceKey];
    return typeof preference === "boolean" ? preference : config.defaultEnabled;
};

let vapidConfigured = false;
const ensureVapidConfigured = (): boolean => {
    if (vapidConfigured) return true;

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) {
        return false;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    return true;
};

export type PushPayload = {
    title: string;
    body: string;
    url?: string;
};

// Most verification-related wrappers already pass an explicit `url` in the payload (see
// verification-workflow.ts / sendUserVerifiedNotification in this directory) - prefer that.
// The remaining push-eligible types (messages, events, follow/community) don't set one today,
// so fall back to the same href logic components/layout/notifications.tsx's
// getNotificationHref already uses for those cases.
export const resolvePushUrl = (type: string, payload: any): string | undefined => {
    if (typeof payload?.url === "string" && payload.url) {
        return payload.url;
    }

    const circleHandle = payload?.circle?.handle;

    switch (type) {
        case "follow_request":
            return circleHandle ? `/circles/${circleHandle}/settings/membership-requests` : undefined;
        case "new_follower":
            return payload?.user?.handle ? `/circles/${payload.user.handle}` : undefined;
        case "follow_accepted":
            return circleHandle ? `/circles/${circleHandle}` : undefined;
        case "pm_received":
            return payload?.roomId ? `/chat/${payload.roomId}` : undefined;
        case "contact_request_received":
        case "contact_request_accepted":
            return payload?.user?.handle ? getCircleDefaultPath(payload.user) : undefined;
        case "event_invitation":
        case "event_artist_added":
        case "event_host_change_decided":
            return circleHandle && payload?.eventId ? `/circles/${circleHandle}/events/${payload.eventId}` : undefined;
        case "event_host_change_requested":
            return circleHandle ? `/circles/${circleHandle}/settings/event-host-requests` : undefined;
        default:
            return undefined;
    }
};

export const sendPushToUser = async (userDid: string, payload: PushPayload): Promise<void> => {
    if (!ensureVapidConfigured()) {
        console.warn("🔔 [PUSH] VAPID keys not configured, skipping push send");
        return;
    }

    const subscriptions = await PushSubscriptions.find({ userId: userDid }).toArray();
    if (!subscriptions.length) {
        return;
    }

    await Promise.all(subscriptions.map((subscription) => sendToSubscription(subscription, payload)));
};

const sendToSubscription = async (subscription: PushSubscriptionDoc, payload: PushPayload): Promise<void> => {
    try {
        await webpush.sendNotification(
            {
                endpoint: subscription.endpoint,
                keys: subscription.keys,
            },
            JSON.stringify(payload),
        );
    } catch (error: any) {
        const statusCode = error?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
            // Subscription expired or was revoked by the browser - stop targeting it.
            await PushSubscriptions.deleteOne({ endpoint: subscription.endpoint });
            return;
        }
        console.error("🔔 [PUSH] Failed to send to subscription:", subscription.endpoint, error);
    }
};

export const savePushSubscription = async (
    userDid: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent?: string,
): Promise<void> => {
    const now = new Date();
    await PushSubscriptions.updateOne(
        { endpoint: subscription.endpoint },
        {
            $set: {
                userId: userDid,
                endpoint: subscription.endpoint,
                keys: subscription.keys,
                userAgent,
                lastSeenAt: now,
            },
            $setOnInsert: { createdAt: now },
        },
        { upsert: true },
    );
};

export const removePushSubscription = async (userDid: string, endpoint: string): Promise<void> => {
    await PushSubscriptions.deleteOne({ userId: userDid, endpoint });
};

export const getPushSubscriptionCountForUser = async (userDid: string): Promise<number> => {
    return await PushSubscriptions.countDocuments({ userId: userDid });
};
