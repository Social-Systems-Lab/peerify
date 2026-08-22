"use server";

import { getCrewMembers, getMember } from "@/lib/data/member";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import CrewMembersTable from "./crew-members-table";
import CrewSpaceModule from "./crew-space";
import CrewOffersWidget from "./crew-offers-widget";
import ContentDisplayWrapper from "@/components/utils/content-display-wrapper";
import { Circle } from "@/models/models";

type CrewModuleProps = {
    circle: Circle;
};

export default async function CrewModule({ circle }: CrewModuleProps) {
    const members = await getCrewMembers(circle?._id);

    // Sidebar (Offers widget) only renders for viewers who could ever see anything in it —
    // this circle's admins/moderators, or its own approved Crew — matching
    // getCrewOffersAction's own independent re-check. A viewer outside both groups (including a
    // non-crew follower, or a crew member of a *different* artist) never even gets the grid's
    // sidebar column, same "nothing to reveal" treatment as the Crew feed itself.
    const viewerDid = await getAuthenticatedUserDid();
    const viewerMember = viewerDid ? await getMember(viewerDid, circle?._id) : null;
    const hasSidebarContent =
        viewerMember?.userGroups?.some((group) => group === "admins" || group === "moderators" || group === "crew") ??
        false;

    return (
        <div className="flex flex-col gap-6">
            <ContentDisplayWrapper content={members}>
                <CrewMembersTable circle={circle} members={members} />
            </ContentDisplayWrapper>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className={hasSidebarContent ? "md:col-span-2" : "md:col-span-3"}>
                    <CrewSpaceModule circle={circle} />
                </div>
                {hasSidebarContent && (
                    <div className="md:col-span-1">
                        <CrewOffersWidget circle={circle} />
                    </div>
                )}
            </div>
        </div>
    );
}
