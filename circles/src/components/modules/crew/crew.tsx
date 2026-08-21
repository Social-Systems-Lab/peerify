"use server";

import { getCrewMembers } from "@/lib/data/member";
import CrewMembersTable from "./crew-members-table";
import ContentDisplayWrapper from "@/components/utils/content-display-wrapper";
import { Circle } from "@/models/models";

type CrewModuleProps = {
    circle: Circle;
};

export default async function CrewModule({ circle }: CrewModuleProps) {
    const members = await getCrewMembers(circle?._id);

    return (
        <ContentDisplayWrapper content={members}>
            <CrewMembersTable circle={circle} members={members} />
        </ContentDisplayWrapper>
    );
}
