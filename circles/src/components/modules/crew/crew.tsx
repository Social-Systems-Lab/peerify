"use server";

import { getCrewMembers } from "@/lib/data/member";
import CrewMembersTable from "./crew-members-table";
import CrewSpaceModule from "./crew-space";
import ContentDisplayWrapper from "@/components/utils/content-display-wrapper";
import { Circle } from "@/models/models";

type CrewModuleProps = {
    circle: Circle;
};

export default async function CrewModule({ circle }: CrewModuleProps) {
    const members = await getCrewMembers(circle?._id);

    // No Offers widget yet (Commit 3) — hasSidebarContent is always false for now, so the main
    // column collapses to full width, matching AboutPage.tsx's grid pattern (src/components/
    // modules/home/AboutPage.tsx:718-965) that this is forked from.
    const hasSidebarContent = false;

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
                    <div className="md:col-span-1">{/* Offers widget lands here in Commit 3 */}</div>
                )}
            </div>
        </div>
    );
}
