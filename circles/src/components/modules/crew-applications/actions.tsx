"use server";

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { getCirclePath, ensureCrewUserGroupOnCircle } from "@/lib/data/circle";
import { features } from "@/lib/data/constants";
import { getMember, addMember, updateMemberUserGroups } from "@/lib/data/member";
import {
    getAllCrewApplications,
    getCrewApplication,
    updatePendingCrewApplicationStatus,
} from "@/lib/data/crew-applications";
import { sendNotifications, buildNotificationBody } from "@/lib/data/notifications";
import { getUserPrivate } from "@/lib/data/user";
import { Circle, CrewApplication } from "@/models/models";
import { revalidatePath } from "next/cache";

type CrewApplicationsResponse = {
    success: boolean;
    message?: string;
    pendingApplications?: CrewApplication[];
    rejectedApplications?: CrewApplication[];
};

export const getAllCrewApplicationsAction = async (circleId: string): Promise<CrewApplicationsResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to view Crew applications" };
    }

    try {
        if (!circleId) {
            return { success: false, message: "Invalid circle ID" };
        }

        const authorized = await isAuthorized(userDid, circleId, features.general.manage_crew_applications);
        if (!authorized) {
            return { success: false, message: "You are not authorized to view Crew applications" };
        }

        const { pendingApplications, rejectedApplications } = await getAllCrewApplications(circleId);
        return { success: true, pendingApplications, rejectedApplications };
    } catch (error) {
        return { success: false, message: "Failed to fetch Crew applications. " + error?.toString() };
    }
};

type UpdateCrewApplicationResponse = {
    success: boolean;
    message?: string;
};

export const approveCrewApplicationAction = async (
    applicationId: string,
    circle: Circle,
    note?: string,
): Promise<UpdateCrewApplicationResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to approve Crew applications" };
    }

    try {
        const authorized = await isAuthorized(userDid, circle._id ?? "", features.general.manage_crew_applications);
        if (!authorized) {
            return { success: false, message: "You are not authorized to manage Crew applications" };
        }

        const application = await getCrewApplication(applicationId);
        const circleId = circle._id ?? "";

        // Self-heal: guarantee this circle has a "crew" userGroup before assigning anyone to it
        // — see ensureCrewUserGroupOnCircle for why this replaces a one-off migration.
        await ensureCrewUserGroupOnCircle(circleId);

        const existingMember = await getMember(application.userDid, circleId);
        if (existingMember) {
            const newGroups = Array.from(new Set([...(existingMember.userGroups ?? []), "crew", "members"]));
            await updateMemberUserGroups(application.userDid, circleId, newGroups);
        } else {
            await addMember(application.userDid, circleId, ["crew", "members"]);
        }

        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}`);

        await updatePendingCrewApplicationStatus(application._id!, "approved");

        const applicant = await getUserPrivate(application.userDid);
        if (applicant) {
            // Optional artist-written note, appended to the standard approval message rather than
            // replacing it — the applicant still sees the normal "You're now part of the Crew!"
            // confirmation, plus whatever the artist chose to add.
            const trimmedNote = note?.trim();
            const messageBody = trimmedNote
                ? `${buildNotificationBody("crew_application_approved", { circle })}\n\n"${trimmedNote}"`
                : undefined;
            await sendNotifications("crew_application_approved", [applicant], { circle, messageBody });
        }

        return { success: true };
    } catch (error) {
        return { success: false, message: "Failed to approve Crew application. " + error?.toString() };
    }
};

export const rejectCrewApplicationAction = async (
    applicationId: string,
    circle: Circle,
): Promise<UpdateCrewApplicationResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to reject Crew applications" };
    }

    try {
        const authorized = await isAuthorized(userDid, circle._id ?? "", features.general.manage_crew_applications);
        if (!authorized) {
            return { success: false, message: "You are not authorized to manage Crew applications" };
        }

        const application = await getCrewApplication(applicationId);

        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}`);

        await updatePendingCrewApplicationStatus(application._id!, "rejected");

        return { success: true };
    } catch (error) {
        return { success: false, message: "Failed to reject Crew application. " + error?.toString() };
    }
};
