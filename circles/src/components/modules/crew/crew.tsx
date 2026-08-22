"use server";

import { getCrewMembers, getMember } from "@/lib/data/member";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import CrewMemberRail from "./crew-member-rail";
import CrewSpaceModule from "./crew-space";
import CrewOffersWidget from "./crew-offers-widget";
import CrewLanding from "./crew-landing";
import ContentDisplayWrapper from "@/components/utils/content-display-wrapper";
import { Circle } from "@/models/models";

type CrewModuleProps = {
    circle: Circle;
};

export default async function CrewModule({ circle }: CrewModuleProps) {
    // The entire page — member rail, feed, Offers — is Crew-only. A viewer who isn't this
    // circle's own admin/moderator or one of its approved Crew members (including a logged-out
    // visitor, or a non-crew follower) gets only the welcome/Join-Crew landing state below, not
    // a suppressed/partial version of the real content. Matches the same "nothing to reveal for
    // an ineligible viewer" treatment the Crew feed itself already had — the member list just
    // hadn't been gated the same way until now.
    const viewerDid = await getAuthenticatedUserDid();
    const viewerMember = viewerDid ? await getMember(viewerDid, circle?._id) : null;
    const isEligible =
        viewerMember?.userGroups?.some((group) => group === "admins" || group === "moderators" || group === "crew") ??
        false;

    if (!isEligible) {
        return <CrewLanding circle={circle} />;
    }

    const members = await getCrewMembers(circle?._id);

    return (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="md:col-span-2">
                <CrewSpaceModule circle={circle} />
            </div>
            <div className="flex flex-col gap-4 md:col-span-1">
                <div className="rounded-[18px] border border-black/5 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
                    <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Crew</h2>
                    <ContentDisplayWrapper content={members}>
                        <CrewMemberRail circle={circle} members={members} />
                    </ContentDisplayWrapper>
                </div>
                <CrewOffersWidget circle={circle} />
            </div>
        </div>
    );
}
