// members/actions.ts - Server actions around memberships
"use server";

import { getAuthenticatedUserDid, getMemberAccessLevel, hasHigherAccess, isAuthorized } from "@/lib/auth/auth";
import {
    approveAdminRoleRemovalRequest,
    createAdminRoleRemovalRequest,
    declineAdminRoleRemovalRequest,
} from "@/lib/data/admin-role-removal";
import { getCircleById, getCirclePath } from "@/lib/data/circle";
import { features } from "@/lib/data/constants";
import { DETACH_ADMIN_CHANGE_BLOCK_MESSAGE, getPendingDetachCircleRequest } from "@/lib/data/circle-detach";
import { addMember, countAdmins, getMember, isCircleAdmin, removeMember, updateMemberUserGroups } from "@/lib/data/member";
import { sendNotifications } from "@/lib/data/notifications";
import { getUserPrivate } from "@/lib/data/user";
import { safeModifyMemberUserGroups } from "@/lib/utils";
import { Circle, MemberDisplay } from "@/models/models";
import { revalidatePath } from "next/cache";
import { isAcceptedConnectionForUserDid, listAcceptedConnectionsForUserDid, searchAcceptedConnectionsForUserDid } from "@/lib/data/relationships";
import {
    acceptAdminInvitation,
    cancelAdminInvitation,
    createPendingAdminInvitation,
    declineAdminInvitation,
} from "@/lib/data/admin-invitations";
import { notifyAdminInvitationDecided, notifyAdminInvitationReceived } from "@/lib/data/admin-invitation-notifications";

type RemoveMemberResponse = {
    success: boolean;
    message?: string;
    adminRoleRemovalRequestState?: "created" | "pending";
};

const ADMIN_ROLE_REMOVAL_REQUEST_CREATED_MESSAGE =
    "Admin removal request created. The admin must approve before their admin role is removed.";
const ADMIN_ROLE_REMOVAL_REQUEST_ALREADY_PENDING_MESSAGE =
    "An admin removal request is already pending for this admin.";

async function notifyTargetAdminOfRemovalRequest(circle: Circle, targetUserDid: string, requestedByDid: string): Promise<void> {
    try {
        const [requester, targetAdmin] = await Promise.all([
            getUserPrivate(requestedByDid),
            getUserPrivate(targetUserDid),
        ]);
        const circlePath = await getCirclePath(circle);

        await sendNotifications("user_verification_request", [targetAdmin], {
            user: requester,
            circle,
            messageBody: `${requester.name || "An admin"} requested to remove your admin role in ${circle.name || "this circle"}.`,
            url: `${circlePath}followers`,
        });
    } catch (error) {
        console.error("Failed to send admin-role removal notification:", error);
    }
}

export const removeMemberAction = async (member: MemberDisplay, circle: Circle): Promise<RemoveMemberResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to remove a member" };
    }

    try {
        // confirm the user is authorized to remove member
        let authorized = await isAuthorized(userDid, circle._id ?? "", features.general.remove_lower_members);
        let canRemoveSameLevel = await isAuthorized(
            userDid,
            circle._id ?? "",
            features.general.remove_same_level_members,
        );

        if (!authorized && !canRemoveSameLevel) {
            return { success: false, message: "You are not authorized to remove this member" };
        }
        authorized = await hasHigherAccess(userDid, member.userDid, circle._id ?? "", canRemoveSameLevel);
        if (!authorized) {
            return { success: false, message: "You don't have high enough access to remove this member" };
        }

        // make sure last admin isn't removed
        const isAdmin = member.userGroups?.includes("admins");
        if (isAdmin) {
            const pendingDetachRequest = await getPendingDetachCircleRequest(circle._id ?? "");
            if (pendingDetachRequest) {
                return { success: false, message: DETACH_ADMIN_CHANGE_BLOCK_MESSAGE };
            }
            const adminCount = await countAdmins(circle._id ?? "");
            if (adminCount <= 1) {
                return { success: false, message: "Cannot remove the last admin." };
            }

            if (member.userDid !== userDid) {
                const { created } = await createAdminRoleRemovalRequest({
                    circleId: circle._id ?? "",
                    targetUserDid: member.userDid,
                    requestedByDid: userDid,
                });

                let circlePath = await getCirclePath(circle);
                revalidatePath(`${circlePath}followers`);

                if (created) {
                    await notifyTargetAdminOfRemovalRequest(circle, member.userDid, userDid);
                    return {
                        success: true,
                        message: ADMIN_ROLE_REMOVAL_REQUEST_CREATED_MESSAGE,
                        adminRoleRemovalRequestState: "created",
                    };
                }

                return {
                    success: true,
                    message: ADMIN_ROLE_REMOVAL_REQUEST_ALREADY_PENDING_MESSAGE,
                    adminRoleRemovalRequestState: "pending",
                };
            }
        }

        // remove member from circle
        await removeMember(member.userDid, circle._id ?? "");

        // clear page cache so page update
        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}followers`);

        return { success: true };
    } catch (error) {
        return { success: false, message: "Failed to remove member. " + error?.toString() };
    }
};

type UpdateUserGroupsResponse = {
    success: boolean;
    message?: string;
    adminRoleRemovalRequestState?: "created" | "pending";
};

export const updateUserGroupsAction = async (
    member: MemberDisplay,
    circle: Circle,
    newGroups: string[],
): Promise<UpdateUserGroupsResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to update user groups" };
    }

    try {
        // confirm the user is authorized to edit user groups
        let authorized = await isAuthorized(userDid, circle._id ?? "", features.general.edit_lower_user_groups);
        let canEditSameLevel = await isAuthorized(
            userDid,
            circle._id ?? "",
            features.general.edit_same_level_user_groups,
        );
        if (!authorized && !canEditSameLevel) {
            return { success: false, message: "You are not authorized to edit user groups" };
        }

        // confirm the user has higher access than the member
        authorized = await hasHigherAccess(userDid, member.userDid, circle._id ?? "", canEditSameLevel);
        if (!authorized) {
            return { success: false, message: "You don't have high enough access to edit this member's user groups" };
        }

        // validate new user groups to ensure they all have lower access level than the current user
        let userAccessLevel = await getMemberAccessLevel(userDid, circle._id ?? "");

        // get current user groups of the member
        const existingMember = await getMember(member.userDid, circle._id ?? "");
        if (!existingMember) {
            throw new Error("Member not found");
        }

        // make sure last admin isn't removed
        const isAdmin = existingMember.userGroups?.includes("admins");
        const isAddingAdmin = !isAdmin && newGroups.includes("admins");
        const isRemovingAdmin = isAdmin && !newGroups.includes("admins");
        if (isAddingAdmin || isRemovingAdmin) {
            const pendingDetachRequest = await getPendingDetachCircleRequest(circle._id ?? "");
            if (pendingDetachRequest) {
                return { success: false, message: DETACH_ADMIN_CHANGE_BLOCK_MESSAGE };
            }
            if (isRemovingAdmin) {
                const adminCount = await countAdmins(circle._id ?? "");
                if (adminCount <= 1) {
                    return { success: false, message: "Cannot remove the last admin." };
                }

                if (member.userDid !== userDid) {
                    const { created } = await createAdminRoleRemovalRequest({
                        circleId: circle._id ?? "",
                        targetUserDid: member.userDid,
                        requestedByDid: userDid,
                    });

                    let circlePath = await getCirclePath(circle);
                    revalidatePath(`${circlePath}followers`);

                    if (created) {
                        await notifyTargetAdminOfRemovalRequest(circle, member.userDid, userDid);
                        return {
                            success: true,
                            message: ADMIN_ROLE_REMOVAL_REQUEST_CREATED_MESSAGE,
                            adminRoleRemovalRequestState: "created",
                        };
                    }

                    return {
                        success: true,
                        message: ADMIN_ROLE_REMOVAL_REQUEST_ALREADY_PENDING_MESSAGE,
                        adminRoleRemovalRequestState: "pending",
                    };
                }
            }
        }

        const existingCircle = await getCircleById(circle?._id ?? "");
        if (!existingCircle) {
            throw new Error("Circle not found");
        }
        const newUserGroups = safeModifyMemberUserGroups(
            existingMember.userGroups ?? [],
            newGroups,
            existingCircle,
            userAccessLevel,
            canEditSameLevel,
        );

        // update member user groups in the circle
        await updateMemberUserGroups(member.userDid, circle._id ?? "", newUserGroups);

        // clear page cache so page update
        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}followers`);

        return { success: true };
    } catch (error) {
        return { success: false, message: "Failed to update user groups. " + error?.toString() };
    }
};

type AdminRoleRemovalRequestResponse = {
    success: boolean;
    message?: string;
};

export const approveAdminRoleRemovalRequestAction = async (
    requestId: string,
    circle: Circle,
): Promise<AdminRoleRemovalRequestResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to approve this request" };
    }

    try {
        await approveAdminRoleRemovalRequest({ requestId, targetUserDid: userDid });

        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}followers`);

        return { success: true, message: "Your admin role was removed for this circle." };
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : "Could not approve the admin removal request.",
        };
    }
};

export const declineAdminRoleRemovalRequestAction = async (
    requestId: string,
    circle: Circle,
): Promise<AdminRoleRemovalRequestResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to decline this request" };
    }

    try {
        await declineAdminRoleRemovalRequest({ requestId, targetUserDid: userDid });

        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}followers`);

        return { success: true, message: "Admin removal request declined." };
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : "Could not decline the admin removal request.",
        };
    }
};

// ---------------------------------------------------------------------------------------------
// Admin invitations - invite an accepted connection (not yet a follower) to a role, requiring
// their acceptance before a Member doc is created. See src/lib/data/admin-invitations.ts.
// ---------------------------------------------------------------------------------------------

type AdminInvitationResponse = {
    success: boolean;
    message?: string;
    alreadyMember?: boolean;
};

// Candidate pool for the invite picker: the CALLER's own accepted connections, independent of
// which circle the invite is for (a group circle's own members/events.view eligibility, which
// getCircleMembersAction/searchEligibleUsersAction use, is the wrong pool here - see UserPicker's
// fetchInitial/fetchSearch override props).
export const getMyAcceptedConnectionsAction = async (): Promise<{ circles: Circle[] }> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) return { circles: [] };
    return { circles: await listAcceptedConnectionsForUserDid(userDid) };
};

export const searchMyAcceptedConnectionsAction = async (
    query: string,
    limit: number = 10,
): Promise<{ circles: Circle[] }> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) return { circles: [] };
    return { circles: await searchAcceptedConnectionsForUserDid(userDid, query, limit) };
};

export const inviteUserToAdminAction = async (
    circle: Circle,
    invitedUserDid: string,
    userGroups: string[],
): Promise<AdminInvitationResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to send an invitation" };
    }

    try {
        if (invitedUserDid === userDid) {
            return { success: false, message: "You can't invite yourself" };
        }

        // Sending is restricted to the circle's admins group specifically (not moderators or any
        // other edit_same_level_user_groups holder) - unlike editing an EXISTING member's groups,
        // there's no target member yet for hasHigherAccess to compare against, so the generic
        // isAuthorized/hasHigherAccess pair updateUserGroupsAction uses doesn't apply cleanly here.
        // This mirrors createAdminRoleRemovalRequest's direct "admins" group check for the same
        // reason - both actions change who holds admin-level access in the circle.
        const isAdmin = await isCircleAdmin(userDid, circle._id ?? "");
        if (!isAdmin) {
            return { success: false, message: "Only circle admins can send admin invitations" };
        }

        const existingMember = await getMember(invitedUserDid, circle._id ?? "");
        if (existingMember) {
            return {
                success: false,
                alreadyMember: true,
                message: "This user is already a follower - use Edit User Groups on their row instead.",
            };
        }

        const isConnection = await isAcceptedConnectionForUserDid(userDid, invitedUserDid);
        if (!isConnection) {
            return { success: false, message: "You can only invite one of your accepted connections" };
        }

        const existingCircle = await getCircleById(circle._id ?? "");
        if (!existingCircle) {
            return { success: false, message: "Circle not found" };
        }

        // Clamp the offered roles to what this admin is actually permitted to grant - same
        // sanitizer updateUserGroupsAction uses, starting from an empty existing-groups baseline
        // since the invitee isn't a member yet.
        const userAccessLevel = await getMemberAccessLevel(userDid, circle._id ?? "");
        const canEditSameLevel = await isAuthorized(userDid, circle._id ?? "", features.general.edit_same_level_user_groups);
        const offeredUserGroups = safeModifyMemberUserGroups([], userGroups, existingCircle, userAccessLevel, canEditSameLevel);

        const { invitation, created } = await createPendingAdminInvitation({
            circleId: circle._id ?? "",
            invitedUserDid,
            invitedByUserDid: userDid,
            userGroups: offeredUserGroups,
        });

        if (created) {
            const [inviter, invitedUser] = await Promise.all([getUserPrivate(userDid), getUserPrivate(invitedUserDid)]);
            if (inviter && invitedUser) {
                await notifyAdminInvitationReceived(existingCircle, inviter, invitedUser, invitation.userGroups);
            }
        }

        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}followers`);

        return {
            success: true,
            message: created ? "Invitation sent." : "An invitation is already pending for this user.",
        };
    } catch (error) {
        return { success: false, message: "Failed to send invitation. " + error?.toString() };
    }
};

export const acceptAdminInvitationAction = async (
    requestId: string,
    circle: Circle,
): Promise<AdminInvitationResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to accept this invitation" };
    }

    try {
        const invitation = await acceptAdminInvitation({ requestId, acceptingUserDid: userDid });

        const [inviterCircle, accepter] = await Promise.all([getCircleById(circle._id ?? ""), getUserPrivate(userDid)]);
        if (inviterCircle && accepter) {
            await notifyAdminInvitationDecided(inviterCircle, accepter, invitation.invitedByUserDid, invitation.userGroups, true);
        }

        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}followers`);

        return { success: true, message: "You're now a member of this circle." };
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : "Could not accept this invitation.",
        };
    }
};

export const declineAdminInvitationAction = async (
    requestId: string,
    circle: Circle,
): Promise<AdminInvitationResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to decline this invitation" };
    }

    try {
        const invitation = await declineAdminInvitation({ requestId, decliningUserDid: userDid });

        const [inviterCircle, decliner] = await Promise.all([getCircleById(circle._id ?? ""), getUserPrivate(userDid)]);
        if (inviterCircle && decliner) {
            await notifyAdminInvitationDecided(inviterCircle, decliner, invitation.invitedByUserDid, invitation.userGroups, false);
        }

        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}followers`);

        return { success: true, message: "Invitation declined." };
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : "Could not decline this invitation.",
        };
    }
};

export const cancelAdminInvitationAction = async (
    requestId: string,
    circle: Circle,
): Promise<AdminInvitationResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to cancel this invitation" };
    }

    try {
        await cancelAdminInvitation({ requestId, cancellingUserDid: userDid });

        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}followers`);

        return { success: true, message: "Invitation cancelled." };
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : "Could not cancel this invitation.",
        };
    }
};
