"use client";

import { useState, useTransition } from "react";
import { Circle } from "@/models/models";
import type { PlatformMembershipCredentialCardData } from "@/lib/vibe-id/membership-credentials";
import SubscriptionForm from "./subscription-form";
import { VerificationSettingsCard } from "./verification-settings-card";
import { VibeIdSettingsCard } from "./vibe-id-settings-card";
import { updateEmailPreferenceSetting, updatePushPreferenceSetting } from "./actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { usePushSubscription } from "@/components/notifications/push/use-push-subscription";

type EmailPreferenceKey = "emailMissedMessages" | "emailTaskAssigned" | "emailTaskUpdates" | "emailVerificationUpdates";

const emailPreferenceOptions: { key: EmailPreferenceKey; label: string; description: string }[] = [
    {
        key: "emailMissedMessages",
        label: "Email me if I miss a message",
        description: "Includes unread direct messages in a once-daily email digest.",
    },
    {
        key: "emailTaskAssigned",
        label: "Email me when I am assigned a task",
        description: "Includes new task assignments in a once-daily email digest.",
    },
    {
        key: "emailTaskUpdates",
        label: "Email me about updates to tasks assigned to me",
        description: "Includes assigned task changes, revision requests, and verification updates in a once-daily email digest.",
    },
    {
        key: "emailVerificationUpdates",
        label: "Email me about verification or admin thread updates that need my response",
        description: "Includes verification and admin thread replies needing your attention in a once-daily email digest.",
    },
];

const getInitialEmailPreferences = (user: Circle): Record<EmailPreferenceKey, boolean> => ({
    emailMissedMessages: user.emailMissedMessages !== false,
    emailTaskAssigned: user.emailTaskAssigned === true,
    emailTaskUpdates: user.emailTaskUpdates === true,
    emailVerificationUpdates: user.emailVerificationUpdates === true,
});

type PushPreferenceKey = "pushMessages" | "pushEvents" | "pushVerification" | "pushCommunity";

const pushPreferenceOptions: { key: PushPreferenceKey; label: string; description: string }[] = [
    {
        key: "pushMessages",
        label: "Messages",
        description: "Direct messages and contact requests.",
    },
    {
        key: "pushEvents",
        label: "Events",
        description: "Event invitations and lineup additions.",
    },
    {
        key: "pushVerification",
        label: "Verification",
        description: "Updates on your account or profile verification.",
    },
    {
        key: "pushCommunity",
        label: "Follow activity",
        description: "New followers and follow requests.",
    },
];

const getInitialPushPreferences = (user: Circle): Record<PushPreferenceKey, boolean> => ({
    pushMessages: user.pushMessages !== false,
    pushEvents: user.pushEvents !== false,
    pushVerification: user.pushVerification !== false,
    pushCommunity: user.pushCommunity === true,
});

export default function SubscriptionFormSettings({
    user,
    membershipCredential,
}: {
    user: Circle;
    membershipCredential?: PlatformMembershipCredentialCardData | null;
}) {
    const [subscriptionAttempted, setSubscriptionAttempted] = useState(false);
    const initialEmailPreferences = getInitialEmailPreferences(user);
    const initialPushPreferences = getInitialPushPreferences(user);

    const handleDialogClose = () => {
        setSubscriptionAttempted(true);
    };

    if (subscriptionAttempted) {
        return (
            <div className="space-y-8">
                <VibeIdSettingsCard user={user} membershipCredential={membershipCredential} />
                {/* Hidden for personal profiles: verification is now automatic once a profile picture
                    and About text are both set (see updateCircle in src/lib/data/circle.ts), so the
                    manual request/thread flow no longer applies here. Not deleted in case manual
                    verification is reintroduced.
                <VerificationSettingsCard user={user} />
                */}
                <PushPreferencesSettingsCard initialValues={initialPushPreferences} />
                <EmailPreferencesSettingsCard initialValues={initialEmailPreferences} />
                {/* Hidden pending a redesign of the membership/deferred-payment model.
                    Not deleted so it's easy to reinstate once the new design lands.
                <section className="space-y-4">
                    <div className="space-y-1 px-1">
                        <h2 className="text-lg font-semibold tracking-tight">Supporting</h2>
                        <p className="text-sm text-muted-foreground">
                            Founding Supporters help keep Peerify open, independent, and useful for artists, hosts, and listeners.
                        </p>
                    </div>
                    <div className="rounded-lg border bg-muted/20 px-6 py-8 text-center">
                        <h3 className="text-2xl font-bold tracking-tight">Thank You!</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Your subscription is being processed. Your supporting membership status will be updated shortly.
                        </p>
                    </div>
                </section>
                */}
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <VibeIdSettingsCard user={user} membershipCredential={membershipCredential} />
            {/* Hidden for personal profiles: verification is now automatic once a profile picture
                and About text are both set (see updateCircle in src/lib/data/circle.ts), so the
                manual request/thread flow no longer applies here. Not deleted in case manual
                verification is reintroduced.
            <VerificationSettingsCard user={user} />
            */}
            <EmailPreferencesSettingsCard initialValues={initialEmailPreferences} />
            {/* Hidden pending a redesign of the membership/deferred-payment model.
                Not deleted so it's easy to reinstate once the new design lands.
            <section className="space-y-4">
                <div className="space-y-1 px-1">
                    <h2 className="text-lg font-semibold tracking-tight">Supporting</h2>
                    <p className="text-sm text-muted-foreground">
                        Founding Supporters help keep Peerify open, independent, and useful for artists, hosts, and listeners.
                    </p>
                </div>
                <SubscriptionForm circle={user} onDialogClose={handleDialogClose} />
            </section>
            */}
        </div>
    );
}

function PushPreferencesSettingsCard({ initialValues }: { initialValues: Record<PushPreferenceKey, boolean> }) {
    const [pushPreferences, setPushPreferences] = useState(initialValues);
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();
    const { supportState, isSubscribed, isBusy, subscribe, unsubscribe } = usePushSubscription();

    const handleCheckedChange = (preference: PushPreferenceKey, checked: boolean) => {
        startTransition(async () => {
            const result = await updatePushPreferenceSetting(preference, checked);

            if (!result.success) {
                toast({ title: result.message, variant: "destructive" });
                return;
            }

            setPushPreferences((current) => ({ ...current, [preference]: checked }));
            toast({ title: result.message });
        });
    };

    const handleEnableToggle = async (checked: boolean) => {
        const result = checked ? await subscribe() : await unsubscribe();
        if (!result.success && result.message) {
            toast({ title: result.message, variant: "destructive" });
        }
    };

    return (
        <Card>
            <CardHeader className="space-y-2 pb-5">
                <CardTitle className="text-2xl font-semibold tracking-tight">Push Notifications</CardTitle>
                <CardDescription className="max-w-2xl text-sm leading-6">
                    Get notified in your browser the moment something happens, no need to have Peerify open.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {supportState === "ios-needs-install" && (
                    <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                        Safari on iPhone/iPad only delivers push notifications to apps added to your Home
                        Screen. Tap <span className="font-medium text-foreground">Share</span> then{" "}
                        <span className="font-medium text-foreground">Add to Home Screen</span>, then open
                        Peerify from the Home Screen icon to turn on notifications.
                    </div>
                )}
                {supportState === "unsupported" && (
                    <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                        Push notifications aren&apos;t supported in this browser.
                    </div>
                )}
                {supportState === "supported" && (
                    <>
                        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                            <div className="space-y-1">
                                <Label htmlFor="push-enable">Enable browser notifications</Label>
                                <p className="text-sm text-muted-foreground">
                                    Turn this on first, then choose what you want to be notified about below.
                                </p>
                            </div>
                            <Switch
                                id="push-enable"
                                checked={isSubscribed}
                                onCheckedChange={handleEnableToggle}
                                disabled={isBusy}
                                aria-label="Enable browser notifications"
                            />
                        </div>
                        {pushPreferenceOptions.map((option) => (
                            <div
                                key={option.key}
                                className="flex items-center justify-between gap-4 rounded-lg border p-4"
                            >
                                <div className="space-y-1">
                                    <Label htmlFor={option.key}>{option.label}</Label>
                                    <p className="text-sm text-muted-foreground">{option.description}</p>
                                </div>
                                <Switch
                                    id={option.key}
                                    checked={pushPreferences[option.key]}
                                    onCheckedChange={(checked) => handleCheckedChange(option.key, checked)}
                                    disabled={isPending || !isSubscribed}
                                    aria-label={option.label}
                                />
                            </div>
                        ))}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function EmailPreferencesSettingsCard({ initialValues }: { initialValues: Record<EmailPreferenceKey, boolean> }) {
    const [emailPreferences, setEmailPreferences] = useState(initialValues);
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();

    const handleCheckedChange = (preference: EmailPreferenceKey, checked: boolean) => {
        startTransition(async () => {
            const result = await updateEmailPreferenceSetting(preference, checked);

            if (!result.success) {
                toast({
                    title: result.message,
                    variant: "destructive",
                });
                return;
            }

            setEmailPreferences((current) => ({
                ...current,
                [preference]: checked,
            }));
            toast({
                title: result.message,
            });
        });
    };

    return (
        <Card>
            <CardHeader className="space-y-2 pb-5">
                <CardTitle className="text-2xl font-semibold tracking-tight">Email Preferences</CardTitle>
                <CardDescription className="max-w-2xl text-sm leading-6">
                    Actionable update emails are grouped into a once-daily digest. Turn off anything you do not want to receive.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {emailPreferenceOptions.map((option) => {
                    const switchId = option.key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

                    return (
                        <div key={option.key} className="flex items-center justify-between gap-4 rounded-lg border p-4">
                            <div className="space-y-1">
                                <Label htmlFor={switchId}>{option.label}</Label>
                                <p className="text-sm text-muted-foreground">{option.description}</p>
                            </div>
                            <Switch
                                id={switchId}
                                checked={emailPreferences[option.key]}
                                onCheckedChange={(checked) => handleCheckedChange(option.key, checked)}
                                disabled={isPending}
                                aria-label={option.label}
                            />
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}
