import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { getCircleByHandle, getCirclesByDids } from "@/lib/data/circle";
import { features } from "@/lib/data/constants";
import { listMessagedRecipientDids } from "@/lib/data/mongo-chat";
import { listPeerifyPledgesForArtist } from "@/lib/data/peerify-pledges";
import { getPeerifyArtistProfile, isPeerifyManagedIdentity } from "@/lib/peerify/artist-profile";
import { ArrowLeft, LockKeyhole, Pencil } from "lucide-react";
import { PledgeDashboardClient } from "./pledge-dashboard-client";

type PageProps = {
    params: Promise<{ handle: string }>;
};

export default async function PeerifyPledgesPage({ params }: PageProps) {
    const { handle } = await params;
    const circle = await getCircleByHandle(handle);

    if (!circle?._id || !isPeerifyManagedIdentity(circle)) {
        notFound();
    }

    const userDid = await getAuthenticatedUserDid();
    const canManage = await isAuthorized(userDid, circle._id, features.settings.edit_about);

    if (!canManage) {
        redirect(`/circles/${handle}/access-denied?module=pledges&redirectTo=/circles/${handle}/settings/pledges`);
    }

    const pledges = await listPeerifyPledgesForArtist(circle._id);
    const uniquePledgerDids = Array.from(new Set(pledges.map((pledge) => pledge.pledgerDid).filter(Boolean)));

    const [messagedPledgerDids, activeCircles] = await Promise.all([
        userDid ? listMessagedRecipientDids(userDid, uniquePledgerDids) : Promise.resolve(new Set<string>()),
        getCirclesByDids(uniquePledgerDids),
    ]);
    // A pledger's account may have been deleted and re-created since they pledged (same email,
    // new did/handle) — the pledge row still renders fine from its own denormalized snapshot,
    // but there's no live circle left to message. See the "Could not find recipient" investigation.
    const activePledgerDids = activeCircles.map((activeCircle) => activeCircle.did).filter(Boolean) as string[];

    // Fallback currency for pledges made before the `currency` field existed — the artist's
    // *current* booking-settings currency, matching what the dashboard implicitly assumed
    // before per-currency grouping existed. Never overrides a pledge's own stored currency.
    const artistCurrency = getPeerifyArtistProfile(circle).bookingSettings.currency || "EUR";

    return (
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-3xl">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="gap-1 rounded-full px-3 py-1">
                                <LockKeyhole className="h-3.5 w-3.5" />
                                Private to profile managers
                            </Badge>
                            <Badge variant="outline" className="rounded-full px-3 py-1">
                                Non-binding demand signals
                            </Badge>
                        </div>
                        <p className="mt-5 text-sm font-medium text-slate-500">Peerify artist intelligence</p>
                        <h1 className="mt-1 text-3xl font-semibold text-[#231f1a] sm:text-4xl">Pledge Dashboard</h1>
                        <p className="mt-3 max-w-2xl text-base text-slate-600">
                            See where fans want you to play, what they might pay, and who can help make a show happen.
                        </p>
                        <p className="mt-3 max-w-2xl text-sm text-slate-500">
                            Pledges are non-binding signals, not ticket purchases or confirmed bookings. Individual
                            pledge details are visible only to profile managers/admins.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                        <Button asChild variant="outline">
                            <Link href={`/circles/${handle}/home`}>
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Back to artist profile
                            </Link>
                        </Button>
                        <Button asChild>
                            <Link href={`/circles/${handle}/settings/about`}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit artist profile
                            </Link>
                        </Button>
                    </div>
                </div>
            </div>

            {pledges.length === 0 ? (
                <Card className="rounded-lg border-dashed border-slate-300 bg-slate-50 shadow-none">
                    <CardContent className="flex min-h-40 flex-col items-center justify-center px-6 py-10 text-center">
                        <h2 className="text-xl font-semibold text-[#231f1a]">No pledges yet</h2>
                        <p className="mt-2 max-w-xl text-sm text-slate-600">
                            No pledges yet. When fans signal interest in a local show, their responses will appear here.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <PledgeDashboardClient
                    pledges={pledges}
                    initialMessagedDids={Array.from(messagedPledgerDids)}
                    activePledgerDids={activePledgerDids}
                    fallbackCurrency={artistCurrency}
                />
            )}
        </main>
    );
}
