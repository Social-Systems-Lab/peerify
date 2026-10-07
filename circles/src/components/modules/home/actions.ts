"use server";

import { verifyUserToken } from "@/lib/auth/jwt";
import { readAuthToken } from "@/lib/auth/cookie";
import { addMember, countAdmins, getMember, removeMember } from "@/lib/data/member";
import { ChatRoom, Circle, UserPrivate } from "@/models/models";
import { cookies } from "next/headers";
import { createPendingMembershipRequest, deletePendingMembershipRequest } from "@/lib/data/membership-requests";
import { createPendingCrewApplication } from "@/lib/data/crew-applications";
import { getCircleById, getCirclePath, updateCircle, getCircleByDid, getCirclesByIds, isCirclePublished } from "@/lib/data/circle";
import { DETACH_ADMIN_CHANGE_BLOCK_MESSAGE, getPendingDetachCircleRequest } from "@/lib/data/circle-detach";
import { getAuthenticatedUserDid, getAuthorizedMembers, isAuthorized } from "@/lib/auth/auth";
import { features } from "@/lib/data/constants";
import { saveFile } from "@/lib/data/storage";
import { revalidatePath } from "next/cache";
import { getUser, getUserById, getUserPrivate, addBookmark, removeBookmark, pinCircle, unpinCircle } from "@/lib/data/user";
import { notifyNewMember, sendNotifications } from "@/lib/data/notifications";
import { findOrCreateDMRoom as findOrCreateDMRoomData } from "@/lib/data/chat";
import {
    getDmEligibility,
    getEffectiveConnectStatus,
    getProfileRelationshipState,
    getRelationshipEdge,
    isWithinConnectionCooldown,
    isAcceptedConnectionForUserDid,
    listToolboxConnectionsForUserDid,
    ToolboxConnectionsSummary,
} from "@/lib/data/relationships";
import { Circles, UserRelationships } from "@/lib/data/db";
import { canPerformRestrictedAction, getRestrictedActionMessage } from "@/lib/auth/verification";

type CircleActionResponse = {
    success: boolean;
    message?: string;
    pending?: boolean;
    circle?: Circle;
};

export const getUserPrivateAction = async (): Promise<UserPrivate | undefined> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return undefined;
    }

    return await getUserPrivate(userDid);
};

// Bypasses the suppressed-profile-preview placeholder for viewers who already follow the
// profile owner's circle or have them as an accepted contact — reuses the same relationship
// signals as FollowButton (Members collection) and MessageButton's "Connect" flow
// (UserRelationships accepted edges) rather than introducing a new relationship concept.
// The viewer's identity is derived from the auth cookie, not a client-supplied value, so a
// caller can't fake "I'm a follower" to unlock a private profile.
export const getProfilePreviewAccessAction = async (
    targetCircleId: string,
    targetDid: string,
): Promise<{ hasAccess: boolean }> => {
    const viewerDid = await getAuthenticatedUserDid();
    if (!viewerDid || !targetCircleId || !targetDid) {
        return { hasAccess: false };
    }
    if (viewerDid === targetDid) {
        return { hasAccess: true };
    }

    // Superadmins (user.isAdmin) see the real preview for any profile, regardless of the
    // owner's mapVisible/searchable settings — resolved here from a trusted DB lookup on the
    // cookie-derived viewerDid, not a client-supplied flag. Mirrors the bypass already added to
    // getSwipeCircles/searchDiscoverableCircles.
    const [viewer, membership, isContact] = await Promise.all([
        Circles.findOne({ did: viewerDid }, { projection: { isAdmin: 1 } }),
        getMember(viewerDid, targetCircleId),
        isAcceptedConnectionForUserDid(viewerDid, targetDid),
    ]);

    return { hasAccess: viewer?.isAdmin === true || Boolean(membership) || isContact };
};

export const followCircle = async (circle: Circle, answers?: Record<string, string>): Promise<CircleActionResponse> => {
    let isUser = circle?.circleType === "user";
    const token = readAuthToken(await cookies());

    try {
        if (!token) {
            return { success: false, message: "You need to be logged in to follow a circle" };
        }

        let payload = await verifyUserToken(token);
        let userDid = payload.userDid as string;
        if (!userDid) {
            return { success: false, message: "Authentication failed" };
        }

        let updatedCircle = await getCircleById(circle._id ?? "");

        if (!updatedCircle) {
            return { success: false, message: isUser ? "User not found" : "Circle not found" };
        }

        const existingMember = await getMember(userDid, updatedCircle._id ?? "");
        if (existingMember) {
            return {
                success: true,
                message: isUser ? "You are already following user" : "You are already following circle",
                pending: false,
            };
        }

        if (updatedCircle.isPublic) {
            await addMember(userDid, updatedCircle._id ?? "", ["members"], answers);
            await notifyNewMember(userDid, updatedCircle, true);

            return {
                success: true,
                message: isUser ? "You are now following user" : "You are now following circle",
                pending: false,
            };
        } else {
            await createPendingMembershipRequest(userDid, updatedCircle._id ?? "", answers);
            let members = await getAuthorizedMembers(updatedCircle, features.general.manage_membership_requests);
            let user = await getUser(userDid);
            const recipientUsers: UserPrivate[] = [];
            for (const memberCircle of members) {
                if (memberCircle.did) {
                    const userPrivate = await getUserPrivate(memberCircle.did);
                    if (userPrivate) {
                        recipientUsers.push(userPrivate);
                    }
                }
            }
            await sendNotifications("follow_request", recipientUsers, { circle: updatedCircle, user });

            return {
                success: true,
                message: isUser ? "Your follow request has been sent" : "Your request to follow has been sent",
                pending: true,
            };
        }
    } catch (error) {
        console.error("Failed to follow circle", error);
        return {
            success: false,
            message: (isUser ? "Failed to follow user" : "Failed to follow circle. ") + error?.toString(),
        };
    }
};

// Client-callable equivalent of the authorizedToEdit prop home.tsx computes server-side for the
// full profile page — CirclePreview (the map/search popup card) is a client component with no
// such prop, so it needs its own fresh check to gate Pledge Interest/Join Crew the same way. A
// logged-out or non-admin viewer gets false, never an error, so the card can just hide the
// buttons rather than branch on a failure case.
export const getViewerIsCircleAdminAction = async (circleId: string): Promise<{ isAdmin: boolean }> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid || !circleId) {
        return { isAdmin: false };
    }
    const isAdmin = await isAuthorized(userDid, circleId, features.settings.edit_about);
    return { isAdmin };
};

// Applying for Crew doesn't create/replace the applicant's membership itself — that only
// happens once an admin/mod approves the application (see approveCrewApplicationAction, which
// branches on addMember vs. updateMemberUserGroups since the applicant is almost always
// already a follower). This just records the application and notifies whoever can approve it,
// mirroring followCircle's private-circle branch (createPendingMembershipRequest + notify).
export const applyForCrewMembership = async (circle: Circle, message: string): Promise<CircleActionResponse> => {
    const token = readAuthToken(await cookies());

    try {
        if (!token) {
            return { success: false, message: "You need to be logged in to apply for Crew" };
        }

        let payload = await verifyUserToken(token);
        let userDid = payload.userDid as string;
        if (!userDid) {
            return { success: false, message: "Authentication failed" };
        }

        let updatedCircle = await getCircleById(circle._id ?? "");
        if (!updatedCircle) {
            return { success: false, message: "Circle not found" };
        }

        // Re-check server-side, not just trust that the Join Crew button was hidden client-side —
        // a stale open dialog or a direct call could otherwise still submit an application after
        // the artist has turned Crew off.
        if (updatedCircle.crewEnabled === false) {
            return { success: false, message: "Crew is not currently available for this circle" };
        }

        // Same check the Join Crew button's own visibility is gated on (see home-content.tsx's
        // authorizedToEdit) — enforced here too, not just via the hidden button, so a direct call
        // can't have this circle's own admin apply to their own Crew.
        const isCircleAdmin = await isAuthorized(userDid, updatedCircle._id ?? "", features.settings.edit_about);
        if (isCircleAdmin) {
            return { success: false, message: "You manage this profile, so you can't apply to its own Crew." };
        }

        const existingMember = await getMember(userDid, updatedCircle._id ?? "");
        if (existingMember?.userGroups?.includes("crew")) {
            return { success: true, message: "You are already in this circle's Crew", pending: false };
        }

        await createPendingCrewApplication(userDid, updatedCircle._id ?? "", message);

        let members = await getAuthorizedMembers(updatedCircle, features.general.manage_crew_applications);
        let user = await getUser(userDid);
        const recipientUsers: UserPrivate[] = [];
        for (const memberCircle of members) {
            if (memberCircle.did) {
                const userPrivate = await getUserPrivate(memberCircle.did);
                if (userPrivate) {
                    recipientUsers.push(userPrivate);
                }
            }
        }
        await sendNotifications("crew_application", recipientUsers, { circle: updatedCircle, user });

        return { success: true, message: "Your Crew application has been sent", pending: true };
    } catch (error) {
        console.error("Failed to apply for crew membership", error);
        return { success: false, message: "Failed to submit your Crew application. " + error?.toString() };
    }
};

export const leaveCircle = async (circle: Circle): Promise<CircleActionResponse> => {
    let isUser = circle?.circleType === "user";
    const token = readAuthToken(await cookies());

    try {
        if (!token) {
            return { success: false, message: "You need to be logged in to leave a circle" };
        }

        let payload = await verifyUserToken(token);
        let userDid = payload.userDid as string;
        if (!userDid) {
            return { success: false, message: "Authentication failed" };
        }

        let member = await getMember(userDid, circle._id ?? "");
        if (!member) {
            throw new Error("Member not found");
        }
        const isAdmin = member.userGroups?.includes("admins");
        if (isAdmin) {
            const pendingDetachRequest = await getPendingDetachCircleRequest(circle._id ?? "");
            if (pendingDetachRequest) {
                return { success: false, message: DETACH_ADMIN_CHANGE_BLOCK_MESSAGE };
            }
            const adminCount = await countAdmins(circle._id ?? "");
            if (adminCount <= 1) {
                return { success: false, message: "Cannot leave as last admin." };
            }
        }
        await removeMember(userDid, circle._id ?? "");
        return { success: true, message: isUser ? "You have unfollowed the user" : "You have unfollowed the circle" };
    } catch (error) {
        return {
            success: false,
            message: (isUser ? "Failed to unfollow user" : "Failed to unfollow circle. ") + error?.toString(),
        };
    }
};

export const cancelFollowRequest = async (circle: Circle): Promise<CircleActionResponse> => {
    const token = readAuthToken(await cookies());

    try {
        if (!token) {
            return { success: false, message: "You need to be logged in to cancel a follow request" };
        }

        let payload = await verifyUserToken(token);
        let userDid = payload.userDid as string;
        if (!userDid) {
            return { success: false, message: "Authentication failed" };
        }

        await deletePendingMembershipRequest(userDid, circle._id ?? "");
        return { success: true, message: "Your follow request has been canceled" };
    } catch (error) {
        return { success: false, message: "Failed to cancel follow request. " + error?.toString() };
    }
};

/**
 * Toggle bookmark for a circle. Returns the updated UserPrivate on success.
 */
export const toggleBookmarkAction = async (circleId: string): Promise<UserPrivate | undefined> => {
    const token = readAuthToken(await cookies());

    try {
        if (!token) {
            return undefined;
        }

        const payload = await verifyUserToken(token);
        const userDid = payload.userDid as string;
        if (!userDid) {
            return undefined;
        }

        // Server-side visibility check, mirroring isDiscoverableCircle/isSuppressedPersonalProfile
        // (search.ts / content-preview.tsx) rather than a new rule: a personal profile the owner
        // hasn't made searchable is only visible to admins, followers, or accepted contacts — same
        // bypass getProfilePreviewAccessAction already computes for the preview card itself. Non-user
        // circles (communities/venues) have no such restriction, matching isDiscoverableCircle.
        const targetCircle = await getCircleById(circleId);
        if (!targetCircle || !isCirclePublished(targetCircle)) {
            return undefined;
        }
        if (targetCircle.circleType === "user" && (targetCircle as any)?.searchable !== true) {
            const { hasAccess } = await getProfilePreviewAccessAction(circleId, targetCircle.did as string);
            if (!hasAccess) {
                return undefined;
            }
        }

        // Get current user and toggle bookmark based on current state
        const current = (await getUserPrivate(userDid)) as UserPrivate;
        const currentList = current.bookmarkedCircles ?? [];
        const isBookmarked = currentList.includes(circleId);

        if (isBookmarked) {
            await removeBookmark(userDid, circleId);
        } else {
            await addBookmark(userDid, circleId);
        }

        // Return updated user
        const updated = (await getUserPrivate(userDid)) as UserPrivate;
        return updated;
    } catch (error) {
        console.error("Failed to toggle bookmark", error);
        return undefined;
    }
};

/**
 * Fetch bookmarked circles for the authenticated user.
 */
export const getBookmarkedCirclesAction = async (): Promise<Circle[]> => {
    try {
        // Prefer server-side auth util if available
        const token = readAuthToken(await cookies());
        if (!token) {
            return [];
        }
        const payload = await verifyUserToken(token);
        const userDid = payload.userDid as string;
        if (!userDid) {
            return [];
        }

        const user = (await getUserPrivate(userDid)) as UserPrivate;
        const ids = user.bookmarkedCircles ?? [];
        if (!ids || ids.length === 0) {
            return [];
        }
        const circles = await getCirclesByIds(ids, userDid);
        return circles;
    } catch (error) {
        console.error("Failed to load bookmarked circles", error);
        return [];
    }
};

/**
 * Pin a circle for the current user. Returns updated UserPrivate.
 */
export const pinCircleAction = async (circleId: string): Promise<UserPrivate | undefined> => {
    const token = readAuthToken(await cookies());
    try {
        if (!token) return undefined;
        const payload = await verifyUserToken(token);
        const userDid = payload.userDid as string;
        if (!userDid) return undefined;

        await pinCircle(userDid, circleId);
        const updated = (await getUserPrivate(userDid)) as UserPrivate;
        return updated;
    } catch (e) {
        console.error("Failed to pin circle", e);
        return undefined;
    }
};

/**
 * Unpin a circle for the current user. Returns updated UserPrivate.
 */
export const unpinCircleAction = async (circleId: string): Promise<UserPrivate | undefined> => {
    const token = readAuthToken(await cookies());
    try {
        if (!token) return undefined;
        const payload = await verifyUserToken(token);
        const userDid = payload.userDid as string;
        if (!userDid) return undefined;

        await unpinCircle(userDid, circleId);
        const updated = (await getUserPrivate(userDid)) as UserPrivate;
        return updated;
    } catch (e) {
        console.error("Failed to unpin circle", e);
        return undefined;
    }
};

// Fields updateUser/updateCircleField accept from the browser. These actions used to copy every
// submitted FormData key into updateCircle's $set, which let any logged-in user write
// server-controlled fields on their own profile (isAdmin, isVerified, verificationStatus,
// isFoundingMember, accountStatus, publishStatus, ...) and any circle editor do the same on
// their circle. Only what the real callers send is allowed: EditableField (home-content.tsx:
// name, description, mission) and the picture uploads (EditableImage, onboarding and
// circle-wizard profile steps). Every other key is ignored.
const INLINE_PROFILE_TEXT_FIELDS = ["name", "description", "mission"] as const;
const INLINE_PROFILE_FILE_FIELDS = ["picture"] as const;

const buildInlineProfileUpdate = async (circleId: string, formData: FormData): Promise<Partial<Circle>> => {
    const updateData: Partial<Circle> = { _id: circleId };

    for (const field of INLINE_PROFILE_TEXT_FIELDS) {
        const value = formData.get(field);
        if (typeof value === "string") {
            updateData[field] = value;
        }
    }

    for (const field of INLINE_PROFILE_FILE_FIELDS) {
        const value = formData.get(field);
        if (value instanceof File) {
            const fileInfo = await saveFile(value, field, circleId, true);
            updateData[field] = fileInfo;
            revalidatePath(fileInfo.url);
        }
    }

    return updateData;
};

export const updateUser = async (userId: string, formData: FormData): Promise<UserPrivate | undefined> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return undefined;
    }

    try {
        const currentUser = await getUserById(userId);
        if (!currentUser || currentUser.did !== userDid) {
            return undefined;
        }

        const updateData = await buildInlineProfileUpdate(userId, formData);

        await updateCircle(updateData, userDid);
        revalidatePath(`/circles/${currentUser.handle}`);
        const updatedUser = await getUserPrivate(userDid);
        return updatedUser;
    } catch (error) {
        console.error("Failed to update user", error);
        return undefined;
    }
};

export const updateCircleField = async (circleId: string, formData: FormData): Promise<CircleActionResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to edit circle settings" };
    }

    try {
        let authorized = await isAuthorized(userDid, circleId, features.settings.edit_about);
        if (!authorized) {
            return { success: false, message: "You are not authorized to edit circle settings" };
        }

        const updateData = await buildInlineProfileUpdate(circleId, formData);

        await updateCircle(updateData, userDid);
        let circle = await getCircleById(circleId);
        if (circle) {
            let circlePath = await getCirclePath(circle);
            revalidatePath(circlePath);
            revalidatePath(`${circlePath}settings/about`);
        }

        const updateMessage =
            circle?.circleType === "user"
                ? "Personal profile updated successfully"
                : `${circle?.name || "Circle"} profile updated successfully`;

        return { success: true, message: updateMessage, circle };
    } catch (error) {
        return { success: false, message: `Failed to update circle. ${error}` };
    }
};

export async function findOrCreateDMRoom(recipient: Circle): Promise<ChatRoom | null> {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) {
            throw new Error("User not authenticated");
        }

        const user = await getCircleByDid(userDid);
        if (!user) {
            throw new Error("User not found");
        }

        if (!recipient?.did) {
            throw new Error("Recipient not found");
        }

        const dmEligibility = await getDmEligibility(userDid, recipient.did);
        if (!dmEligibility.isAllowed) {
            return null;
        }

        const room = await findOrCreateDMRoomData(user, recipient);
        return room;
    } catch (error) {
        console.error("Error finding or creating DM room:", error);
        return null;
    }
}

export const getProfileRelationshipStateAction = async (targetDid: string) => {
    const viewerDid = await getAuthenticatedUserDid();
    if (!viewerDid || !targetDid || viewerDid === targetDid) {
        return null;
    }

    return await getProfileRelationshipState(viewerDid, targetDid);
};

export const listToolboxConnectionsAction = async (): Promise<ToolboxConnectionsSummary> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return {
            accepted: [],
            pendingIncoming: [],
            pendingOutgoing: [],
        };
    }

    return await listToolboxConnectionsForUserDid(userDid);
};

// Flips both edges to accepted and tells the requester. Shared by acceptConnectRequestAction and
// by sendConnectRequestAction's auto-accept (the person you declined asking you back within the
// cooldown), so both paths leave the same state behind.
const acceptConnectionBetween = async (accepterDid: string, requester: Circle): Promise<void> => {
    const requesterDid = requester.did!;
    const now = new Date();
    const [accepterEdge, requesterEdge] = await Promise.all([
        UserRelationships.findOne({ fromDid: accepterDid, toDid: requesterDid }, { projection: { dmPermissionSource: 1 } }),
        UserRelationships.findOne({ fromDid: requesterDid, toDid: accepterDid }, { projection: { dmPermissionSource: 1 } }),
    ]);

    await UserRelationships.updateOne(
        { fromDid: accepterDid, toDid: requesterDid },
        {
            $set: {
                connectStatus: "accepted",
                dmPermission: "allowed",
                dmPermissionSource: accepterEdge?.dmPermissionSource === "recipient_setting" ? "recipient_setting" : "contact",
                updatedAt: now,
            },
            $unset: { declinedAt: "" },
            $setOnInsert: {
                fromDid: accepterDid,
                toDid: requesterDid,
                isFollowing: false,
                createdAt: now,
            },
        },
        { upsert: true },
    );

    await UserRelationships.updateOne(
        { fromDid: requesterDid, toDid: accepterDid },
        {
            $set: {
                connectStatus: "accepted",
                dmPermission: "allowed",
                dmPermissionSource: requesterEdge?.dmPermissionSource === "recipient_setting" ? "recipient_setting" : "contact",
                updatedAt: now,
            },
            $unset: { declinedAt: "" },
            $setOnInsert: {
                fromDid: requesterDid,
                toDid: accepterDid,
                isFollowing: false,
                createdAt: now,
            },
        },
        { upsert: true },
    );

    try {
        const accepter = await getCircleByDid(accepterDid);
        if (accepter?.circleType === "user") {
            await sendNotifications("contact_request_accepted", [requester], {
                user: accepter,
            });
        }
    } catch (notificationError) {
        console.error("Failed to create connection accepted notification", notificationError);
    }
};

export const sendConnectRequestAction = async (
    targetDid: string,
): Promise<{ success: boolean; message: string }> => {
    const viewerDid = await getAuthenticatedUserDid();
    if (!viewerDid) {
        return { success: false, message: "You need to be logged in to connect" };
    }

    if (!targetDid || viewerDid === targetDid) {
        return { success: false, message: "Invalid connection request" };
    }

    const viewer = await getCircleByDid(viewerDid);
    if (!canPerformRestrictedAction(viewer)) {
        return { success: false, message: getRestrictedActionMessage("connect with people") };
    }

    try {
        const targetUser = await getCircleByDid(targetDid);
        if (!targetUser || targetUser.circleType !== "user") {
            return { success: false, message: "Recipient not found" };
        }

        const [viewerEdge, targetEdge] = await Promise.all([
            getRelationshipEdge(viewerDid, targetDid),
            getRelationshipEdge(targetDid, viewerDid),
        ]);
        const connectStatus = getEffectiveConnectStatus(viewerEdge);
        if (connectStatus === "accepted") {
            return { success: false, message: "You're already connected" };
        }

        if (connectStatus === "pending_sent") {
            return { success: true, message: "Connection request already sent" };
        }

        if (connectStatus === "pending_received") {
            return { success: false, message: "This user already requested to connect" };
        }

        const now = new Date();

        // Declined within the cooldown: report success and keep showing "Requested", but write no
        // mirror edge and send no notification, so the requester isn't told about the decline.
        if (isWithinConnectionCooldown(viewerEdge, now)) {
            await UserRelationships.updateOne(
                { fromDid: viewerDid, toDid: targetDid },
                { $set: { connectStatus: "pending_sent", updatedAt: now } },
            );
            return { success: true, message: "Connection request sent" };
        }

        // The viewer declined the target's request and is now asking them back while that request
        // still shows as "Requested" on their side: treat it as accepting it.
        if (targetEdge?.connectStatus === "pending_sent" && isWithinConnectionCooldown(targetEdge, now)) {
            await acceptConnectionBetween(viewerDid, targetUser);
            return { success: true, message: "You're now connected" };
        }

        await UserRelationships.updateOne(
            { fromDid: viewerDid, toDid: targetDid },
            {
                $set: {
                    connectStatus: "pending_sent",
                    updatedAt: now,
                },
                $unset: { declinedAt: "" },
                $setOnInsert: {
                    fromDid: viewerDid,
                    toDid: targetDid,
                    isFollowing: false,
                    dmPermission: "none",
                    dmPermissionSource: "none",
                    createdAt: now,
                },
            },
            { upsert: true },
        );

        await UserRelationships.updateOne(
            { fromDid: targetDid, toDid: viewerDid },
            {
                $set: {
                    connectStatus: "pending_received",
                    updatedAt: now,
                },
                $unset: { declinedAt: "" },
                $setOnInsert: {
                    fromDid: targetDid,
                    toDid: viewerDid,
                    isFollowing: false,
                    dmPermission: "none",
                    dmPermissionSource: "none",
                    createdAt: now,
                },
            },
            { upsert: true },
        );

        try {
            if (viewer?.circleType === "user") {
                await sendNotifications("contact_request_received", [targetUser], {
                    user: viewer,
                });
            }
        } catch (notificationError) {
            console.error("Failed to create connection request notification", notificationError);
        }

        return { success: true, message: "Connection request sent" };
    } catch (error) {
        console.error("Failed to send connect request", error);
        return { success: false, message: "Failed to send connection request" };
    }
};

export const acceptConnectRequestAction = async (
    targetDid: string,
): Promise<{ success: boolean; message: string }> => {
    const viewerDid = await getAuthenticatedUserDid();
    if (!viewerDid) {
        return { success: false, message: "You need to be logged in to accept a connection request" };
    }

    if (!targetDid || viewerDid === targetDid) {
        return { success: false, message: "Invalid connection request" };
    }

    try {
        const targetUser = await getCircleByDid(targetDid);
        if (!targetUser || targetUser.circleType !== "user") {
            return { success: false, message: "Requester not found" };
        }

        const relationshipState = await getProfileRelationshipState(viewerDid, targetDid);
        if (relationshipState.connectStatus !== "pending_received") {
            return { success: false, message: "No incoming connection request to accept" };
        }

        await acceptConnectionBetween(viewerDid, targetUser);

        return { success: true, message: "Connection request accepted" };
    } catch (error) {
        console.error("Failed to accept connect request", error);
        return { success: false, message: "Failed to accept connection request" };
    }
};

export const declineConnectRequestAction = async (
    targetDid: string,
): Promise<{ success: boolean; message: string }> => {
    const viewerDid = await getAuthenticatedUserDid();
    if (!viewerDid) {
        return { success: false, message: "You need to be logged in to decline a connection request" };
    }

    if (!targetDid || viewerDid === targetDid) {
        return { success: false, message: "Invalid connection request" };
    }

    try {
        const targetUser = await getCircleByDid(targetDid);
        if (!targetUser || targetUser.circleType !== "user") {
            return { success: false, message: "Requester not found" };
        }

        const relationshipState = await getProfileRelationshipState(viewerDid, targetDid);
        if (relationshipState.connectStatus !== "pending_received") {
            return { success: false, message: "No incoming connection request to decline" };
        }

        const now = new Date();

        // The decliner's edge resets; the requester's edge stays pending_sent and records the
        // decline, which starts the cooldown (see getEffectiveConnectStatus).
        await Promise.all([
            UserRelationships.updateOne(
                { fromDid: viewerDid, toDid: targetDid },
                {
                    $set: {
                        connectStatus: "none",
                        updatedAt: now,
                    },
                },
            ),
            UserRelationships.updateOne(
                { fromDid: targetDid, toDid: viewerDid },
                {
                    $set: {
                        connectStatus: "pending_sent",
                        declinedAt: now,
                        updatedAt: now,
                    },
                },
            ),
        ]);

        return { success: true, message: "Connection request declined" };
    } catch (error) {
        console.error("Failed to decline connect request", error);
        return { success: false, message: "Failed to decline connection request" };
    }
};
