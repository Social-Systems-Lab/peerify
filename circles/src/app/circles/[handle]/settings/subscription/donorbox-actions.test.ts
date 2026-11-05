// Run: IS_BUILD=true bun test "src/app/circles/[handle]/settings/subscription/donorbox-actions.test.ts"
// Leak round 3, H9 (2026-11-05): getSubscription(subscriptionId) and getPlans() were exports of this
// "use server" file with no login check. getSubscription called the Donorbox API with the platform's
// credentials and returned the whole subscription (donor name, email, address). Nothing in the app
// called either, but Next registers every export of an imported "use server" file as a server action
// (the 2026-11-02 build's server-reference-manifest lists both). They are removed. The other actions
// in the file, used by the settings page and push notifications, stay.

import { describe, expect, mock, test } from "bun:test";

mock.module("@/lib/auth/auth", () => ({ getAuthenticatedUserDid: async () => undefined }));
mock.module("@/lib/data/user", () => ({
    getPrivateUserByDid: async () => null,
    getUserPrivate: async () => null,
    updateUser: async () => undefined,
}));
mock.module("@/lib/data/push", () => ({
    savePushSubscription: async () => undefined,
    removePushSubscription: async () => undefined,
    getPushSubscriptionCountForUser: async () => 0,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));

const actions: Record<string, unknown> = await import("./actions");

describe("subscription settings server actions", () => {
    test("no Donorbox read actions are exported", () => {
        expect("getSubscription" in actions).toBe(false);
        expect("getPlans" in actions).toBe(false);
    });

    test("the actions the app uses are still there", () => {
        for (const name of [
            "updateEmailPreferenceSetting",
            "updatePushPreferenceSetting",
            "subscribeToPushNotifications",
            "unsubscribeFromPushNotifications",
            "getPushSubscriptionStatus",
        ]) {
            expect(typeof actions[name]).toBe("function");
        }
    });
});
