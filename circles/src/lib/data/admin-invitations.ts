import { DETACH_ADMIN_CHANGE_BLOCK_MESSAGE, getPendingDetachCircleRequest } from "@/lib/data/circle-detach";
import { AdminInvitations, Circles } from "./db";
import { addMember, getMember, grantsOwnerOnlyGroup, isCircleAdmin, OWNER_ONLY_ROLE_MESSAGE } from "./member";
import { ADMIN_INVITATION_ALLOWED_USER_GROUPS, AdminInvitation, Circle, FileInfo } from "@/models/models";
import { resolveRoleNames } from "./admin-invitation-notifications";
import { getCircleDefaultPath } from "@/lib/utils/circle-routes";
import { ObjectId } from "mongodb";

export const getPendingAdminInvitationForUserAndCircle = async (
    circleId: string,
    invitedUserDid: string,
): Promise<AdminInvitation | null> => {
    return await AdminInvitations.findOne({ circleId, invitedUserDid, status: "pending" });
};

// The sent-invitation list backing the "Pending invitations" section on Settings/About. Scoped to
// invitedByUserDid on purpose: cancelAdminInvitation below only lets the admin who actually sent an
// invitation retract it, so listing the whole circle's pending invites here would render Cancel
// buttons that can only ever throw for every admin but the sender.
export const getPendingAdminInvitationsSentByUser = async (
    circleId: string,
    invitedByUserDid: string,
): Promise<AdminInvitation[]> => {
    return await AdminInvitations.find({ circleId, invitedByUserDid, status: "pending" })
        .sort({ createdAt: -1 })
        .toArray();
};

const getCircleOwnership = async (circleId: string) => {
    const circle = await Circles.findOne({ _id: new ObjectId(circleId) }, { projection: { did: 1, circleType: 1 } });
    if (!circle) {
        throw new Error("Circle not found");
    }
    return circle;
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

    if (grantsOwnerOnlyGroup(await getCircleOwnership(params.circleId), params.invitedUserDid, requestedUserGroups)) {
        throw new Error(OWNER_ONLY_ROLE_MESSAGE);
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

// A duplicate invite re-notifies the invitee at most once per this window. Admin invitations push by
// default (verification category), so without it an inviter clicking Invite repeatedly could push
// the invitee every time.
export const ADMIN_INVITATION_RENOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Atomically reserves the right to notify the invitee about a pending invitation: succeeds only if
// they haven't been notified within the cooldown, and stamps lastNotifiedAt so a concurrent call
// (e.g. a double-click) can't also send. Returns null when the cooldown hasn't passed. If the send
// then fails, call releaseAdminInvitationNotification so the inviter can retry straight away.
export const claimAdminInvitationNotification = async (
    invitationId: string,
): Promise<{ claimedAt: Date; previousNotifiedAt: Date | null } | null> => {
    const claimedAt = new Date();
    const cutoff = new Date(claimedAt.getTime() - ADMIN_INVITATION_RENOTIFY_COOLDOWN_MS);
    const before = await AdminInvitations.findOneAndUpdate(
        {
            _id: new ObjectId(invitationId),
            status: "pending",
            $or: [{ lastNotifiedAt: { $exists: false } }, { lastNotifiedAt: null }, { lastNotifiedAt: { $lt: cutoff } }],
        },
        { $set: { lastNotifiedAt: claimedAt } },
        { returnDocument: "before" },
    );
    if (!before) {
        return null;
    }
    return { claimedAt, previousNotifiedAt: before.lastNotifiedAt ?? null };
};

// Undoes a claim whose notification failed. Matches on the claim's own timestamp so it never
// clobbers a later successful claim. Restores the previous Date, or removes the field ($unset, not
// undefined - this client has no ignoreUndefined, so undefined would be stored as null).
export const releaseAdminInvitationNotification = async (
    invitationId: string,
    claim: { claimedAt: Date; previousNotifiedAt: Date | null },
): Promise<void> => {
    const filter = { _id: new ObjectId(invitationId), lastNotifiedAt: claim.claimedAt };
    if (claim.previousNotifiedAt) {
        await AdminInvitations.updateOne(filter, { $set: { lastNotifiedAt: claim.previousNotifiedAt } });
    } else {
        await AdminInvitations.updateOne(filter, { $unset: { lastNotifiedAt: "" } });
    }
};

export const acceptAdminInvitation = async (params: {
    requestId: string;
    acceptingUserDid: string;
}): Promise<AdminInvitation> => {
    const invitation = await getRequiredPendingInvitation(params.requestId);
    if (invitation.invitedUserDid !== params.acceptingUserDid) {
        throw new Error("Only the invited user can accept this invitation");
    }

    // Checked at accept time, not just at send time, so an invitation sent before personal
    // profiles stopped allowing these roles can't still be honoured.
    if (grantsOwnerOnlyGroup(await getCircleOwnership(invitation.circleId), invitation.invitedUserDid, invitation.userGroups)) {
        throw new Error(OWNER_ONLY_ROLE_MESSAGE);
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

// Lets the inviting admin retract an invitation before the invitee responds. Kept as a "cancelled"
// status rather than deleted so the invitee's invitation page can say it was cancelled instead of
// 404ing. Every pending lookup filters on status "pending", so a re-invite after a cancel creates a
// fresh invitation.
export const cancelAdminInvitation = async (params: {
    requestId: string;
    cancellingUserDid: string;
}): Promise<void> => {
    const invitation = await getRequiredPendingInvitation(params.requestId);
    if (invitation.invitedByUserDid !== params.cancellingUserDid) {
        throw new Error("Only the admin who sent this invitation can cancel it");
    }

    await AdminInvitations.updateOne(
        { _id: invitation._id, status: "pending" },
        { $set: { status: "cancelled", cancelledAt: new Date() } },
    );
};

// What the invitee's invitation page may show - identity-level fields only, never full circle or
// user documents.
export type AdminInvitationForInvitee = {
    invitationId: string;
    status: AdminInvitation["status"];
    roleNames: string;
    circle: { name: string; handle: string; picture?: FileInfo };
    // The circle's default module page (getCircleDefaultPath). The bare /circles/<handle> resolves
    // to the feed module in middleware and 404s on circles without it.
    circlePath?: string;
    inviterName: string;
    // Set when a pending invitation can no longer be accepted.
    invalidReason?: string;
};

// Returns null unless viewerDid is the invitee, so callers can 404 everyone else without
// revealing whether the invitation (or the circle) exists.
export const getAdminInvitationForInvitee = async (
    invitationId: string,
    viewerDid: string,
): Promise<AdminInvitationForInvitee | null> => {
    if (!/^[0-9a-f]{24}$/i.test(invitationId)) {
        return null;
    }

    const invitation = await AdminInvitations.findOne({ _id: new ObjectId(invitationId) });
    if (!invitation || invitation.invitedUserDid !== viewerDid) {
        return null;
    }

    const circle = await Circles.findOne(
        { _id: new ObjectId(invitation.circleId) },
        { projection: { name: 1, handle: 1, picture: 1, userGroups: 1, did: 1, circleType: 1, enabledModules: 1 } },
    );
    if (!circle) {
        return null;
    }

    const inviter = await Circles.findOne(
        { did: invitation.invitedByUserDid, circleType: "user" },
        { projection: { name: 1 } },
    );

    // Same checks acceptAdminInvitation makes, so the page doesn't offer an Accept that can only fail.
    let invalidReason: string | undefined;
    if (invitation.status === "pending") {
        if (grantsOwnerOnlyGroup(circle, invitation.invitedUserDid, invitation.userGroups)) {
            invalidReason = "This invitation is no longer valid.";
        } else if (!(await isCircleAdmin(invitation.invitedByUserDid, invitation.circleId))) {
            invalidReason = "This invitation is no longer valid because the inviting admin no longer has admin access.";
        }
    }

    return {
        invitationId,
        status: invitation.status,
        roleNames: resolveRoleNames(circle as Circle, invitation.userGroups),
        circle: {
            name: circle.name || "this circle",
            handle: circle.handle || "",
            ...(circle.picture?.url ? { picture: { url: circle.picture.url } } : {}),
        },
        ...(circle.handle ? { circlePath: getCircleDefaultPath(circle) } : {}),
        inviterName: inviter?.name || "An admin",
        ...(invalidReason ? { invalidReason } : {}),
    };
};
