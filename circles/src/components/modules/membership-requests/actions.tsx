"use server";

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { getCirclePath } from "@/lib/data/circle";
import { features } from "@/lib/data/constants";
import { notifyNewMember } from "@/lib/data/notifications";
import { addMember } from "@/lib/data/member";
import {
    getAllMembershipRequests,
    getMembershipRequest,
    updatePendingMembershipRequestStatus,
} from "@/lib/data/membership-requests";
import { Circle, MembershipRequest } from "@/models/models";
import { revalidatePath } from "next/cache";

type MembershipRequestsResponse = {
    success: boolean;
    message?: string;
    pendingRequests?: MembershipRequest[];
    rejectedRequests?: MembershipRequest[];
};

export const getAllMembershipRequestsAction = async (circleId: string): Promise<MembershipRequestsResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to view follow requests" };
    }

    try {
        if (!circleId) {
            return { success: false, message: "Invalid circle ID" };
        }

        // check if the user is authorized to view membership requests
        const authorized = await isAuthorized(userDid, circleId, features.general.manage_membership_requests);
        if (!authorized) {
            return { success: false, message: "You are not authorized to view follow requests" };
        }

        const { pendingRequests, rejectedRequests } = await getAllMembershipRequests(circleId);
        return { success: true, pendingRequests, rejectedRequests };
    } catch (error) {
        return { success: false, message: "Failed to fetch follow requests. " + error?.toString() };
    }
};

type UpdateMembershipRequestResponse = {
    success: boolean;
    message?: string;
};

// Leak round 3, integrity (2026-11-07): the permission check is made on the circle the client
// sends, so the request must belong to that same circle (as for crew applications, 0be44136).
// Without this, an admin of one circle could approve another circle's requester as a follower of
// their own circle, or reject another circle's request, by sending its id.
const NOT_THIS_CIRCLE_MESSAGE = "This request isn't for this circle.";
const belongsToCircle = (request: MembershipRequest | null, circleId: string): request is MembershipRequest =>
    !!request && !!circleId && String(request.circleId) === String(circleId);

export const approveMembershipRequestAction = async (
    requestId: string,
    circle: Circle,
): Promise<UpdateMembershipRequestResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to approve membership requests" };
    }

    try {
        // Check if the user is authorized to approve membership requests
        const authorized = await isAuthorized(userDid, circle._id ?? "", features.general.manage_membership_requests);
        if (!authorized) {
            return { success: false, message: "You are not authorized to manage membership requests" };
        }

        // get member request
        const request = await getMembershipRequest(requestId);
        if (!belongsToCircle(request, circle._id ?? "")) {
            return { success: false, message: NOT_THIS_CIRCLE_MESSAGE };
        }

        // add member
        await addMember(request.userDid, circle._id ?? "", ["members"], request.questionnaireAnswers);

        // notify members
        await notifyNewMember(request.userDid, circle);

        // clear page cache
        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}`);

        // update status of request
        await updatePendingMembershipRequestStatus(request._id!, "approved");

        return { success: true };
    } catch (error) {
        return { success: false, message: "Failed to approve membership request. " + error?.toString() };
    }
};

export const rejectMembershipRequestAction = async (
    requestId: string,
    circle: Circle,
): Promise<UpdateMembershipRequestResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to reject membership requests" };
    }

    try {
        // Check if the user is authorized to reject membership requests
        const authorized = await isAuthorized(userDid, circle._id ?? "", features.general.manage_membership_requests);
        if (!authorized) {
            return { success: false, message: "You are not authorized to manage membership requests" };
        }

        // get member request
        const request = await getMembershipRequest(requestId);
        if (!belongsToCircle(request, circle._id ?? "")) {
            return { success: false, message: NOT_THIS_CIRCLE_MESSAGE };
        }

        // Clear page cache
        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}`);

        // update status of request
        await updatePendingMembershipRequestStatus(request._id!, "rejected");

        return { success: true };
    } catch (error) {
        return { success: false, message: "Failed to reject membership request. " + error?.toString() };
    }
};
