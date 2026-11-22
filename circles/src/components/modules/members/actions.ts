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
import {
    addMember,
    countAdmins,
    getMember,
    grantsOwnerOnlyGroup,
    isCircleAdmin,
    isSuperadmin,
    OWNER_ONLY_ROLE_MESSAGE,
    removeMember,
    updateMemberUserGroups,
} from "@/lib/data/member";
import { sendNotifications } from "@/lib/data/notifications";
import { getUserPrivate } from "@/lib/data/user";
import { safeModifyMemberUserGroups } from "@/lib/utils";
import { getAdminInvitationPath } from "@/lib/utils/circle-routes";
import { ADMIN_INVITATION_ALLOWED_USER_GROUPS, Circle, MemberDisplay } from "@/models/models";
import { revalidatePath } from "next/cache";
import { isAcceptedConnectionForUserDid, listAcceptedConnectionsForUserDid, searchAcceptedConnectionsForUserDid } from "@/lib/data/relationships";
import {
    acceptAdminInvitation,
    cancelAdminInvitation,
    claimAdminInvitationNotification,
    createPendingAdminInvitation,
    declineAdminInvitation,
    releaseAdminInvitationNotification,
} from "@/lib/data/admin-invitations";
import {
    notifyAdminInvitationDecided,
    notifyAdminInvitationReceived,
    resolveRoleNames,
} from "@/lib/data/admin-invitation-notifications";

type RemoveMemberResponse = {
    success: boolean;
    message?: string;
    adminRoleRemovalRequestState?: "created" | "pending";
};

const ADMIN_ROLE_REMOVAL_REQUEST_CREATED_MESSAGE =
    "Admin removal request created. The admin must approve before their admin role is removed.";
const ADMIN_ROLE_REMOVAL_REQUEST_ALREADY_PENDING_MESSAGE =
    "An admin removal request is already pending for this admin.";
const CREATOR_REMOVAL_MESSAGE = "Only a Peerify admin can remove the creator of this circle.";
const CREATOR_DEMOTION_MESSAGE = "Only a Peerify admin can take the admin role from the creator of this circle.";
// The creator never removes themselves or drops their own admin role, superadmin or not (matches
// leaveCircle). A superadmin can still remove or demote a creator who is someone else.
const CREATOR_SELF_REMOVAL_MESSAGE = "As the creator of this circle you can't leave it.";
const CREATOR_SELF_DEMOTION_MESSAGE = "As the creator of this circle you can't give up the admin role.";

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

// Removing a member (2026-11-22). Only the target's DID and the circle's id are taken from the
// client: the target's groups and the circle's creator are read from the database. Before, "is the
// target an admin?" read the userGroups of the member object the browser sent, so an admin could
// send an admin's or the creator's DID with userGroups: [] and remove them outright, skipping the
// removal request and the last-admin rule.
// - The creator (circle.createdBy) can be removed only by a superadmin (user.isAdmin), and never by
//   themselves, even as a superadmin (2026-11-22, like leaveCircle).
// - An admin can be removed directly by the creator or a superadmin. Another admin only creates a
//   removal request, which the target must approve. Admins may still remove themselves.
// - Never the last admin, and no admin changes while a detach request is pending.
// Superadmins don't need a role in the circle; everyone else needs the remove permissions as before.
export const removeMemberAction = async (member: MemberDisplay, circle: Circle): Promise<RemoveMemberResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to remove a member" };
    }

    try {
        const circleId = circle._id ?? "";
        const targetDid = member.userDid;
        const existingCircle = circleId ? await getCircleById(circleId) : null;
        if (!existingCircle) {
            return { success: false, message: "Circle not found" };
        }
        const target = await getMember(targetDid, circleId);
        if (!target) {
            return { success: false, message: "This person is not a member of this circle" };
        }

        const callerIsSuperadmin = await isSuperadmin(userDid);
        const callerIsCreator = !!existingCircle.createdBy && existingCircle.createdBy === userDid;
        const targetIsCreator = !!existingCircle.createdBy && existingCircle.createdBy === targetDid;
        const targetIsAdmin = target.userGroups?.includes("admins") ?? false;

        if (targetIsCreator && targetDid === userDid) {
            return { success: false, message: CREATOR_SELF_REMOVAL_MESSAGE };
        }
        if (targetIsCreator && !callerIsSuperadmin) {
            return { success: false, message: CREATOR_REMOVAL_MESSAGE };
        }

        if (!callerIsSuperadmin) {
            // confirm the user is authorized to remove member
            let authorized = await isAuthorized(userDid, circleId, features.general.remove_lower_members);
            let canRemoveSameLevel = await isAuthorized(userDid, circleId, features.general.remove_same_level_members);

            if (!authorized && !canRemoveSameLevel) {
                return { success: false, message: "You are not authorized to remove this member" };
            }
            authorized = await hasHigherAccess(userDid, targetDid, circleId, canRemoveSameLevel);
            if (!authorized) {
                return { success: false, message: "You don't have high enough access to remove this member" };
            }
        }

        // make sure last admin isn't removed
        if (targetIsAdmin) {
            const pendingDetachRequest = await getPendingDetachCircleRequest(circleId);
            if (pendingDetachRequest) {
                return { success: false, message: DETACH_ADMIN_CHANGE_BLOCK_MESSAGE };
            }
            const adminCount = await countAdmins(circleId);
            if (adminCount <= 1) {
                return { success: false, message: "Cannot remove the last admin." };
            }

            const removesDirectly = callerIsSuperadmin || callerIsCreator || targetDid === userDid;
            if (!removesDirectly) {
                const { created } = await createAdminRoleRemovalRequest({
                    circleId,
                    targetUserDid: targetDid,
                    requestedByDid: userDid,
                });

                let circlePath = await getCirclePath(existingCircle);
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
        await removeMember(targetDid, circleId);

        // clear page cache so page update
        let circlePath = await getCirclePath(existingCircle);
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
        // Taking the admin role away follows removeMemberAction's rule (2026-11-22): only a
        // superadmin can demote the creator, and the creator never demotes themselves (superadmin
        // or not); the creator and superadmins demote an admin directly, another admin only
        // creates a removal request the target must approve; never the last admin. Groups and the creator are read from the database. Superadmins need no role in
        // the circle and may edit every group (still never an owner-only group, see below).
        const circleId = circle._id ?? "";
        const existingCircle = circleId ? await getCircleById(circleId) : null;
        if (!existingCircle) {
            throw new Error("Circle not found");
        }
        const callerIsSuperadmin = await isSuperadmin(userDid);
        const callerIsCreator = !!existingCircle.createdBy && existingCircle.createdBy === userDid;
        const targetIsCreator = !!existingCircle.createdBy && existingCircle.createdBy === member.userDid;

        let canEditSameLevel = true;
        let userAccessLevel = 0; // a superadmin ranks above every group
        if (!callerIsSuperadmin) {
            // confirm the user is authorized to edit user groups
            let authorized = await isAuthorized(userDid, circleId, features.general.edit_lower_user_groups);
            canEditSameLevel = await isAuthorized(userDid, circleId, features.general.edit_same_level_user_groups);
            if (!authorized && !canEditSameLevel) {
                return { success: false, message: "You are not authorized to edit user groups" };
            }

            // confirm the user has higher access than the member
            authorized = await hasHigherAccess(userDid, member.userDid, circleId, canEditSameLevel);
            if (!authorized) {
                return {
                    success: false,
                    message: "You don't have high enough access to edit this member's user groups",
                };
            }

            // validate new user groups to ensure they all have lower access level than the current user
            userAccessLevel = await getMemberAccessLevel(userDid, circleId);
        }

        // get current user groups of the member
        const existingMember = await getMember(member.userDid, circleId);
        if (!existingMember) {
            throw new Error("Member not found");
        }

        // make sure last admin isn't removed
        const isAdmin = existingMember.userGroups?.includes("admins");
        const isAddingAdmin = !isAdmin && newGroups.includes("admins");
        const isRemovingAdmin = isAdmin && !newGroups.includes("admins");
        if (isRemovingAdmin && targetIsCreator && member.userDid === userDid) {
            return { success: false, message: CREATOR_SELF_DEMOTION_MESSAGE };
        }
        if (isRemovingAdmin && targetIsCreator && !callerIsSuperadmin) {
            return { success: false, message: CREATOR_DEMOTION_MESSAGE };
        }
        if (isAddingAdmin || isRemovingAdmin) {
            const pendingDetachRequest = await getPendingDetachCircleRequest(circleId);
            if (pendingDetachRequest) {
                return { success: false, message: DETACH_ADMIN_CHANGE_BLOCK_MESSAGE };
            }
            if (isRemovingAdmin) {
                const adminCount = await countAdmins(circleId);
                if (adminCount <= 1) {
                    return { success: false, message: "Cannot remove the last admin." };
                }

                const demotesDirectly = callerIsSuperadmin || callerIsCreator || member.userDid === userDid;
                if (!demotesDirectly) {
                    const { created } = await createAdminRoleRemovalRequest({
                        circleId,
                        targetUserDid: member.userDid,
                        requestedByDid: userDid,
                    });

                    let circlePath = await getCirclePath(existingCircle);
                    revalidatePath(`${circlePath}followers`);

                    if (created) {
                        await notifyTargetAdminOfRemovalRequest(existingCircle, member.userDid, userDid);
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

        const newUserGroups = safeModifyMemberUserGroups(
            existingMember.userGroups ?? [],
            newGroups,
            existingCircle,
            userAccessLevel,
            canEditSameLevel,
        );

        // Non-owners can't be given admins/moderators on a personal profile; groups they already
        // hold are left alone (see grantsOwnerOnlyGroup).
        if (grantsOwnerOnlyGroup(existingCircle, member.userDid, newUserGroups, existingMember.userGroups ?? [])) {
            return { success: false, message: OWNER_ONLY_ROLE_MESSAGE };
        }

        // update member user groups in the circle
        await updateMemberUserGroups(member.userDid, circleId, newUserGroups);

        // clear page cache so page update
        let circlePath = await getCirclePath(existingCircle);
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
    // The invitation was created but the invitee couldn't be notified about it.
    notificationFailed?: boolean;
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

        // This flow only ever offers admin-level roles - Follower/Crew are granted by following or
        // applying, not by admin invitation. Enforced here AND independently in
        // createPendingAdminInvitation, since that's the actual DB write path - don't rely on the
        // picker UI (which only shows these two checkboxes) being the sole guard.
        const requestedUserGroups = userGroups.filter((group) =>
            (ADMIN_INVITATION_ALLOWED_USER_GROUPS as readonly string[]).includes(group),
        );
        if (requestedUserGroups.length === 0) {
            return { success: false, message: "Admin invitations can only offer the Admin or Moderator role" };
        }

        const existingCircle = await getCircleById(circle._id ?? "");
        if (!existingCircle) {
            return { success: false, message: "Circle not found" };
        }

        if (grantsOwnerOnlyGroup(existingCircle, invitedUserDid, requestedUserGroups)) {
            return { success: false, message: OWNER_ONLY_ROLE_MESSAGE };
        }

        // Clamp the offered roles to what this admin is actually permitted to grant - same
        // sanitizer updateUserGroupsAction uses, starting from an empty existing-groups baseline
        // since the invitee isn't a member yet.
        const userAccessLevel = await getMemberAccessLevel(userDid, circle._id ?? "");
        const canEditSameLevel = await isAuthorized(userDid, circle._id ?? "", features.general.edit_same_level_user_groups);
        const offeredUserGroups = safeModifyMemberUserGroups([], requestedUserGroups, existingCircle, userAccessLevel, canEditSameLevel);

        const { invitation, created } = await createPendingAdminInvitation({
            circleId: circle._id ?? "",
            invitedUserDid,
            invitedByUserDid: userDid,
            userGroups: offeredUserGroups,
        });

        // The invitation exists from here on, so nothing below may turn this into a "Failed"
        // result - a failed notification is reported as such, not as a failed invitation.
        // A duplicate invite while one is pending re-notifies the invitee, subject to the cooldown
        // in claimAdminInvitationNotification.
        const invitationId = invitation._id?.toString() ?? "";
        let notification: "sent" | "failed" | "cooldown" = "failed";
        try {
            const claim = invitationId ? await claimAdminInvitationNotification(invitationId) : null;
            if (invitationId && !claim) {
                notification = "cooldown";
            } else if (claim) {
                let notified = false;
                try {
                    const [inviter, invitedUser] = await Promise.all([getUserPrivate(userDid), getUserPrivate(invitedUserDid)]);
                    if (inviter && invitedUser) {
                        notified = await notifyAdminInvitationReceived(
                            existingCircle,
                            inviter,
                            invitedUser,
                            invitation.userGroups,
                            invitationId,
                        );
                    }
                } catch (error) {
                    console.error("Error loading users for admin invitation notification:", error);
                }
                if (notified) {
                    notification = "sent";
                } else {
                    await releaseAdminInvitationNotification(invitationId, claim);
                }
            }
        } catch (error) {
            console.error("Error notifying about admin invitation:", error);
        }

        try {
            let circlePath = await getCirclePath(existingCircle);
            revalidatePath(`${circlePath}followers`);
        } catch (error) {
            console.error("Error revalidating after admin invitation:", error);
        }

        if (!created) {
            const pending = `An invitation is already pending for this user, offering ${resolveRoleNames(existingCircle, invitation.userGroups)}.`;
            const changeRoles =
                "To offer different roles, cancel it under Settings › About › Pending invitations and send a new one.";
            if (notification === "sent") {
                return { success: true, message: `${pending} We've sent them a reminder. ${changeRoles}` };
            }
            if (notification === "cooldown") {
                return {
                    success: true,
                    message: `${pending} They were notified in the last 24 hours, so no reminder was sent. ${changeRoles}`,
                };
            }
            return {
                success: true,
                notificationFailed: true,
                message: `${pending} We couldn't send them a reminder. Try again later. ${changeRoles}`,
            };
        }
        if (notification !== "sent") {
            return {
                success: true,
                notificationFailed: true,
                message: "The invitation was created, but we couldn't notify them about it. Invite them again to retry.",
            };
        }
        return { success: true, message: "Invitation sent." };
    } catch (error) {
        return { success: false, message: "Failed to send invitation. " + error?.toString() };
    }
};

// The circle is taken from the invitation itself, never from the client - a caller could otherwise
// pass any circle and have the decision notification and revalidation point at it.
export const acceptAdminInvitationAction = async (requestId: string): Promise<AdminInvitationResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to accept this invitation" };
    }

    try {
        const invitation = await acceptAdminInvitation({ requestId, acceptingUserDid: userDid });

        const [invitationCircle, accepter] = await Promise.all([getCircleById(invitation.circleId), getUserPrivate(userDid)]);
        if (invitationCircle && accepter) {
            await notifyAdminInvitationDecided(invitationCircle, accepter, invitation.invitedByUserDid, invitation.userGroups, true);
        }

        if (invitationCircle) {
            let circlePath = await getCirclePath(invitationCircle);
            revalidatePath(`${circlePath}followers`);
        }
        revalidatePath(getAdminInvitationPath(requestId));

        return { success: true, message: "You're now a member of this circle." };
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : "Could not accept this invitation.",
        };
    }
};

export const declineAdminInvitationAction = async (requestId: string): Promise<AdminInvitationResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to decline this invitation" };
    }

    try {
        const invitation = await declineAdminInvitation({ requestId, decliningUserDid: userDid });

        const [invitationCircle, decliner] = await Promise.all([getCircleById(invitation.circleId), getUserPrivate(userDid)]);
        if (invitationCircle && decliner) {
            await notifyAdminInvitationDecided(invitationCircle, decliner, invitation.invitedByUserDid, invitation.userGroups, false);
        }

        if (invitationCircle) {
            let circlePath = await getCirclePath(invitationCircle);
            revalidatePath(`${circlePath}followers`);
        }
        revalidatePath(getAdminInvitationPath(requestId));

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
