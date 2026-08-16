"use client";

import { useCallback, useEffect, useState } from "react";
import { subscribeToPushNotifications, unsubscribeFromPushNotifications } from "@/app/circles/[handle]/settings/subscription/actions";

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
};

export type PushSupportState = "checking" | "unsupported" | "ios-needs-install" | "supported";

const isIosDevice = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

const isRunningAsInstalledApp = (): boolean =>
    (navigator as any).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;

export const usePushSubscription = () => {
    const [supportState, setSupportState] = useState<PushSupportState>("checking");
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [isBusy, setIsBusy] = useState(false);

    useEffect(() => {
        const hasPushApi = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

        if (!hasPushApi) {
            setSupportState(isIosDevice() && !isRunningAsInstalledApp() ? "ios-needs-install" : "unsupported");
            return;
        }

        setSupportState("supported");

        navigator.serviceWorker.getRegistration("/sw.js").then(async (registration) => {
            const subscription = await registration?.pushManager.getSubscription();
            setIsSubscribed(!!subscription);
        });
    }, []);

    const subscribe = useCallback(async () => {
        if (supportState !== "supported") return { success: false, message: "Push notifications aren't supported here." };

        setIsBusy(true);
        try {
            const permission = await Notification.requestPermission();
            if (permission !== "granted") {
                return { success: false, message: "Notification permission was not granted." };
            }

            const registration = await navigator.serviceWorker.register("/sw.js");
            await navigator.serviceWorker.ready;

            const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
            if (!vapidPublicKey) {
                return { success: false, message: "Push notifications aren't configured." };
            }

            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
            });

            const json = subscription.toJSON();
            const result = await subscribeToPushNotifications(
                { endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } },
                navigator.userAgent,
            );

            if (result.success) {
                setIsSubscribed(true);
            }
            return result;
        } catch (error) {
            console.error("Failed to subscribe to push notifications", error);
            return { success: false, message: "Failed to enable push notifications." };
        } finally {
            setIsBusy(false);
        }
    }, [supportState]);

    const unsubscribe = useCallback(async () => {
        setIsBusy(true);
        try {
            const registration = await navigator.serviceWorker.getRegistration("/sw.js");
            const subscription = await registration?.pushManager.getSubscription();
            if (subscription) {
                await unsubscribeFromPushNotifications(subscription.endpoint);
                await subscription.unsubscribe();
            }
            setIsSubscribed(false);
            return { success: true };
        } catch (error) {
            console.error("Failed to unsubscribe from push notifications", error);
            return { success: false, message: "Failed to disable push notifications." };
        } finally {
            setIsBusy(false);
        }
    }, []);

    return { supportState, isSubscribed, isBusy, subscribe, unsubscribe };
};
