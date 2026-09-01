import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { getCircleByHandle } from "@/lib/data/circle";
import { features } from "@/lib/data/constants";
import { getCrewMembers, getCrewOfferings } from "@/lib/data/member";
import { isPeerifyManagedIdentity } from "@/lib/peerify/artist-profile";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { CrewDashboardClient } from "./crew-dashboard-client";

type PageProps = {
    params: Promise<{ handle: string }>;
};

export default async function CrewDashboardPage({ params }: PageProps) {
    const { handle } = await params;
    const circle = await getCircleByHandle(handle);

    if (!circle?._id || !isPeerifyManagedIdentity(circle)) {
        notFound();
    }

    const userDid = await getAuthenticatedUserDid();
    const canManage = await isAuthorized(userDid, circle._id, features.settings.edit_about);

    if (!canManage) {
        redirect(`/circles/${handle}/access-denied?module=crew&redirectTo=/circles/${handle}/settings/crew`);
    }

    // getCrewOfferings excludes members with zero offerings entirely (see its own comment), so
    // the roster (the source of truth for who's a Crew member at all) and the offerings lookup
    // are fetched separately and left-joined below rather than derived from one query — a member
    // with no offerings must still show up as a card, just with an empty offerings section.
    const [members, offerers] = await Promise.all([
        getCrewMembers(circle._id),
        getCrewOfferings(circle._id, undefined, true),
    ]);

    const offeringsByDid = new Map(offerers.map((offerer) => [offerer.userDid, offerer.tourTeamOfferings]));
    const roster = members.map((member) => ({
        ...member,
        tourTeamOfferings: offeringsByDid.get(member.userDid) ?? [],
    }));

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
                        </div>
                        <p className="mt-5 text-sm font-medium text-slate-500">Peerify artist intelligence</p>
                        <h1 className="mt-1 text-3xl font-semibold text-[#231f1a] sm:text-4xl">Crew Dashboard</h1>
                        <p className="mt-3 max-w-2xl text-base text-slate-600">
                            See who&apos;s in your Crew, where they are, and what they&apos;ve offered to help with.
                        </p>
                        <p className="mt-3 max-w-2xl text-sm text-slate-500">
                            Offerings are each member&apos;s general standing offer to help touring artists — not
                            something they&apos;ve committed specifically to you or this tour.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                        <Button asChild variant="outline">
                            <Link href={`/circles/${handle}/home`}>
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Back to artist profile
                            </Link>
                        </Button>
                    </div>
                </div>
            </div>

            {roster.length === 0 ? (
                <Card className="rounded-lg border-dashed border-slate-300 bg-slate-50 shadow-none">
                    <CardContent className="flex min-h-40 flex-col items-center justify-center px-6 py-10 text-center">
                        <h2 className="text-xl font-semibold text-[#231f1a]">No Crew members yet</h2>
                        <p className="mt-2 max-w-xl text-sm text-slate-600">
                            When fans join your Crew, they&apos;ll show up here.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <CrewDashboardClient members={roster} />
            )}
        </main>
    );
}
