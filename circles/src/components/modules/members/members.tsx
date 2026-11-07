"use server";

import { getPendingAdminRoleRemovalRequest } from "@/lib/data/admin-role-removal";
import { getPendingAdminInvitationForUserAndCircle } from "@/lib/data/admin-invitations";
import { resolveRoleNames } from "@/lib/data/admin-invitation-notifications";
import { getMembersWithMetrics } from "@/lib/data/member";
import { getUserPrivate } from "@/lib/data/user";
import AdminRoleRemovalBanner from "./admin-role-removal-banner";
import AdminInvitationBanner from "./admin-invitation-banner";
import MembersTable from "./members-table";
import ContentDisplayWrapper from "@/components/utils/content-display-wrapper";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { Circle, SortingOptions } from "@/models/models";

type PageProps = {
    circle: Circle;
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
    // false: the viewer may open the page only for a pending admin invitation's banner, not for the
    // list (followers/page.tsx; the list is for the circle's admins and moderators).
    showList?: boolean;
};

export default async function MembersModule(props: PageProps) {
    const circle = props.circle;
    const searchParams = await props.searchParams;

    // get members of circle
    let userDid = await getAuthenticatedUserDid();
    const showList = props.showList !== false;
    let members = showList
        ? await getMembersWithMetrics(userDid, circle?._id, searchParams?.sort as SortingOptions)
        : [];
    const pendingAdminRoleRemovalRequest =
        userDid && circle?._id ? await getPendingAdminRoleRemovalRequest(circle._id, userDid) : null;
    const requester =
        pendingAdminRoleRemovalRequest?.requestedByDid
            ? await getUserPrivate(pendingAdminRoleRemovalRequest.requestedByDid)
            : null;
    // Personal profiles no longer take admin invitations (acceptance is refused server-side), so
    // an invitation sent before that rule gets no banner.
    const pendingAdminInvitation =
        userDid && circle?._id && circle.circleType !== "user"
            ? await getPendingAdminInvitationForUserAndCircle(circle._id, userDid)
            : null;
    const inviter = pendingAdminInvitation ? await getUserPrivate(pendingAdminInvitation.invitedByUserDid) : null;
    if (circle?.circleType === "user") {
        members = members.filter((m) => m.userDid !== circle.did);
    }

    return (
        <ContentDisplayWrapper content={members}>
            {pendingAdminRoleRemovalRequest ? (
                <AdminRoleRemovalBanner
                    circle={circle}
                    requestId={pendingAdminRoleRemovalRequest._id?.toString?.() ?? ""}
                    requesterName={requester?.name}
                />
            ) : null}
            {pendingAdminInvitation ? (
                <AdminInvitationBanner
                    circle={circle}
                    requestId={pendingAdminInvitation._id?.toString?.() ?? ""}
                    inviterName={inviter?.name}
                    roleNames={resolveRoleNames(circle, pendingAdminInvitation.userGroups)}
                />
            ) : null}
            {showList ? (
                <MembersTable circle={circle} members={members} />
            ) : (
                <p className="p-4 text-sm text-muted-foreground">
                    Only this circle&apos;s admins and moderators see the follower list.
                </p>
            )}
        </ContentDisplayWrapper>
    );
}
