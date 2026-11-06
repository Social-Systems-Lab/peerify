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
import { toIdentityCircle } from "@/lib/utils/public-circle";
import { getAllCrewApplicationsAction } from "@/components/modules/crew-applications/actions";
import CrewApplicationsTable from "@/components/modules/crew-applications/crew-applications-table";
import CrewOffNote from "@/components/modules/crew-applications/crew-off-note";
import { isCrewOn } from "@/lib/peerify/crew-visibility";
import { ArrowLeft, ArrowRight, LockKeyhole } from "lucide-react";
import { CrewDashboardClient } from "./crew-dashboard-client";

type PageProps = {
    params: Promise<{ handle: string }>;
};

export default async function CrewDashboardPage({ params }: PageProps) {
    const { handle } = await params;
    const circle = await getCircleByHandle(handle);

    if (!circle?._id) {
        notFound();
    }
    // The crew_application notification's Review button comes here for every circle. Circles that
    // aren't managed artist identities (e.g. personal profiles with Crew) have no Dashboard; their
    // applications stay on the Crew Applications settings page, which checks access itself.
    if (!isPeerifyManagedIdentity(circle)) {
        redirect(`/circles/${handle}/settings/crew-applications`);
    }

    const userDid = await getAuthenticatedUserDid();
    const canManage = await isAuthorized(userDid, circle._id, features.settings.edit_about);

    if (!canManage) {
        redirect(`/circles/${handle}/access-denied?module=crew&redirectTo=/circles/${handle}/settings/crew`);
    }

    // Crew switched off (Settings > Modules or the About toggle): managers get a short note with
    // the way back, not the roster or the applications. Pending applications stay stored.
    const crewOn = isCrewOn(circle);

    // getCrewOfferings excludes members with zero offerings entirely (see its own comment), so
    // the roster (the source of truth for who's a Crew member at all) and the offerings lookup
    // are fetched separately and left-joined below rather than derived from one query — a member
    // with no offerings must still show up as a card, just with an empty offerings section.
    const [members, offerers, applications] = await Promise.all([
        crewOn ? getCrewMembers(circle._id, userDid) : Promise.resolve([]),
        crewOn ? getCrewOfferings(circle._id, undefined, true) : Promise.resolve([]),
        // Same action and permission check (manage_crew_applications) as the Crew Applications
        // settings page; anyone without it gets success: false and no section.
        getAllCrewApplicationsAction(circle._id),
    ]);
    const pendingApplications = applications.success ? (applications.pendingApplications ?? []) : null;
    // The table's approve/reject actions need only the circle's id, handle and name.
    const identityCircle = JSON.parse(JSON.stringify(toIdentityCircle(circle)));

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

            {!crewOn ? (
                <CrewOffNote
                    handle={handle}
                    aboutToggleOff={circle.crewEnabled === false}
                    pendingCount={pendingApplications?.length ?? 0}
                />
            ) : null}

            {crewOn && pendingApplications ? (
                <section id="applications" className="scroll-mt-24 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                        <h2 className="text-xl font-semibold text-[#231f1a]">
                            Crew applications
                            {pendingApplications.length > 0 ? (
                                <Badge className="ml-2 rounded-full bg-red-500 px-2.5 py-0.5 align-middle text-white hover:bg-red-500">
                                    {pendingApplications.length} pending
                                </Badge>
                            ) : null}
                        </h2>
                        <Link
                            href={`/circles/${handle}/settings/crew-applications`}
                            className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                            Rejected applications and Crew settings
                            <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </div>
                    <div className="mt-4">
                        <CrewApplicationsTable circle={identityCircle} applications={pendingApplications} />
                    </div>
                </section>
            ) : null}

            {!crewOn ? null : roster.length === 0 ? (
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
