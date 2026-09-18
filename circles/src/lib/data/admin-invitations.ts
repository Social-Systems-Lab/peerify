import { DETACH_ADMIN_CHANGE_BLOCK_MESSAGE, getPendingDetachCircleRequest } from "@/lib/data/circle-detach";
import { AdminInvitations } from "./db";
import { addMember, getMember, isCircleAdmin } from "./member";
import { ADMIN_INVITATION_ALLOWED_USER_GROUPS, AdminInvitation } from "@/models/models";
import { ObjectId } from "mongodb";

export const getPendingAdminInvitationForUserAndCircle = async (
    circleId: string,
    invitedUserDid: string,
): Promise<AdminInvitation | null> => {
    return await AdminInvitations.findOne({ circleId, invitedUserDid, status: "pending" });
};

const getRequiredPendingInvitation = async (requestId: string): Promise<AdminInvitation> => {
    const invitation = await AdminInvitations.findOne({ _id: new ObjectId(requestId), status: "pending" });
    if (!invitation) {
        throw new Error("Admin invitation not found");
    }
    return invitation;
};

export const createPendingAdminInvitation = async (params: {
    circleId: string;
    invitedUserDid: string;
    invitedByUserDid: string;
    userGroups: string[];
}): Promise<{ invitation: AdminInvitation; created: boolean }> => {
    if (params.invitedUserDid === params.invitedByUserDid) {
        throw new Error("You can't invite yourself");
    }

    const inviterMember = await getMember(params.invitedByUserDid, params.circleId);
    if (!inviterMember?.userGroups?.includes("admins")) {
        throw new Error("Only circle admins can send admin invitations");
    }

    const existingMember = await getMember(params.invitedUserDid, params.circleId);
    if (existingMember) {
        throw new Error("User is already a member of this circle");
    }

    const requestedUserGroups = params.userGroups.filter((group) =>
        (ADMIN_INVITATION_ALLOWED_USER_GROUPS as readonly string[]).includes(group),
    );
    if (requestedUserGroups.length === 0) {
        throw new Error("Admin invitations can only offer the Admin or Moderator role");
    }

    if (requestedUserGroups.includes("admins")) {
        const pendingDetachRequest = await getPendingDetachCircleRequest(params.circleId);
        if (pendingDetachRequest) {
            throw new Error(DETACH_ADMIN_CHANGE_BLOCK_MESSAGE);
        }
    }

    const existingInvitation = await getPendingAdminInvitationForUserAndCircle(
        params.circleId,
        params.invitedUserDid,
    );
    if (existingInvitation) {
        return { invitation: existingInvitation, created: false };
    }

    const invitation: AdminInvitation = {
        circleId: params.circleId,
        invitedUserDid: params.invitedUserDid,
        invitedByUserDid: params.invitedByUserDid,
        userGroups: requestedUserGroups,
        status: "pending",
        createdAt: new Date(),
    };

    await AdminInvitations.insertOne(invitation);
    return { invitation, created: true };
};

export const acceptAdminInvitation = async (params: {
    requestId: string;
    acceptingUserDid: string;
}): Promise<AdminInvitation> => {
    const invitation = await getRequiredPendingInvitation(params.requestId);
    if (invitation.invitedUserDid !== params.acceptingUserDid) {
        throw new Error("Only the invited user can accept this invitation");
    }

    // Re-validate the inviter is still an admin - a stale invitation from someone who has since
    // lost admin access (removed, demoted, admin-role-removal approved) must not still be honorable.
    const inviterStillAdmin = await isCircleAdmin(invitation.invitedByUserDid, invitation.circleId);
    if (!inviterStillAdmin) {
        throw new Error("This invitation is no longer valid because the inviting admin no longer has admin access.");
    }

    if (invitation.userGroups.includes("admins")) {
        const pendingDetachRequest = await getPendingDetachCircleRequest(invitation.circleId);
        if (pendingDetachRequest) {
            throw new Error(DETACH_ADMIN_CHANGE_BLOCK_MESSAGE);
        }
    }

    await addMember(invitation.invitedUserDid, invitation.circleId, invitation.userGroups);

    const respondedAt = new Date();
    await AdminInvitations.updateOne(
        { _id: invitation._id },
        { $set: { status: "accepted", respondedAt } },
    );

    return { ...invitation, status: "accepted", respondedAt };
};

export const declineAdminInvitation = async (params: {
    requestId: string;
    decliningUserDid: string;
}): Promise<AdminInvitation> => {
    const invitation = await getRequiredPendingInvitation(params.requestId);
    if (invitation.invitedUserDid !== params.decliningUserDid) {
        throw new Error("Only the invited user can decline this invitation");
    }

    const respondedAt = new Date();
    await AdminInvitations.updateOne(
        { _id: invitation._id },
        { $set: { status: "declined", respondedAt } },
    );

    return { ...invitation, status: "declined", respondedAt };
};

// Lets the inviting admin retract an invitation before the invitee responds. Implemented as a
// hard delete of the pending doc rather than a 4th status value, since nothing needs to query
// "cancelled" invitations afterward - unlike accepted/declined, there's no history to preserve.
export const cancelAdminInvitation = async (params: {
    requestId: string;
    cancellingUserDid: string;
}): Promise<void> => {
    const invitation = await getRequiredPendingInvitation(params.requestId);
    if (invitation.invitedByUserDid !== params.cancellingUserDid) {
        throw new Error("Only the admin who sent this invitation can cancel it");
    }

    await AdminInvitations.deleteOne({ _id: invitation._id });
};
