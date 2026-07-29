"use client";

import { useAtom } from "jotai";
import { CheckCircle2 } from "lucide-react";
import { CodeOfConductAgreement } from "@/components/auth/code-of-conduct-agreement";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import {
    COMMUNITY_GUIDELINE_RULES,
    isCommunityGuidelinesCompleted,
} from "@/lib/community-guidelines";
import { userAtom } from "@/lib/data/atoms";

const formatAcceptedAt = (value?: Date | string | null): string | null => {
    if (!value) {
        return null;
    }

    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    }).format(parsed);
};

// Standalone, proactive entry point for signing Peerify's Community Guidelines from the
// personal profile's own Settings/About page. Before this existed, signing guidelines was
// reachable NOWHERE: the guarded-composer participation gate (see
// src/lib/auth/participation-readiness.ts) deliberately never checks guidelines acceptance,
// and the only other UI that ever rendered the agreement (CodeOfConductAgreement, via
// VerifyAccountButton) has been commented out at all its render sites since the 2026-07-08
// auto-verify migration hid the manual verification flow. That left users with no way to
// satisfy isPilotArtistCircleReadyToPublish's guidelines requirement (src/lib/data/circle.ts)
// no matter what they did on their own profile. Reuses acceptCodeOfConductAction (accepts all
// five rules at once) rather than the separate, unwired rule-by-rule
// CommunityGuidelinesAgreementFlow (src/components/auth/community-guidelines-gate.tsx), to
// match what VerifyAccountButton already does elsewhere and avoid introducing a second
// signing UX.
//
// This reads communityGuidelinesAcceptance off the globally-hydrated userAtom (the VIEWER's
// own data), not off the `circle` prop the rest of this settings page renders from — the
// SAFE_CIRCLE_PROJECTION getCircleByHandle/getCircleById use to fetch `circle` deliberately
// excludes that field (see src/lib/data/circle.ts). Since /settings/about isn't itself
// ownership-gated at the route level (only the save/publish server actions enforce
// isAuthorized), `ownProfileHandle` guards against showing the viewer's own guidelines status
// if they land on someone else's personal-profile settings page.
export function CommunityGuidelinesSettingsCard({ ownProfileHandle }: { ownProfileHandle?: string }) {
    const [user, setUser] = useAtom(userAtom);
    const { toast } = useToast();

    if (!user?.handle || user.handle !== ownProfileHandle) {
        return null;
    }

    const completed = isCommunityGuidelinesCompleted(user?.communityGuidelinesAcceptance);
    const acceptedAtLabel = formatAcceptedAt(user?.communityGuidelinesAcceptedAt);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Community Guidelines</CardTitle>
                <CardDescription>
                    Peerify&apos;s core community rules for honest, respectful participation. Signing them is required
                    to publish an artist or venue profile you created, and is separate from posting/commenting
                    verification.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {completed ? (
                    <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                        <div className="space-y-2">
                            <p className="font-medium">
                                You&apos;ve agreed to all five of Peerify&apos;s community rules
                                {acceptedAtLabel ? ` (${acceptedAtLabel})` : ""}.
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {COMMUNITY_GUIDELINE_RULES.map((rule) => (
                                    <span
                                        key={rule.id}
                                        className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800"
                                    >
                                        {rule.title}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <CodeOfConductAgreement
                        user={user}
                        onUserChange={(nextUser) => setUser(nextUser)}
                        onComplete={async () => {
                            toast({ title: "Success", description: "Community Guidelines accepted." });
                            return { success: true };
                        }}
                    />
                )}
            </CardContent>
        </Card>
    );
}
