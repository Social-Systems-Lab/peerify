import { CrewApplication } from "@/models/models";
import { CrewApplications } from "./db";
import { ObjectId } from "mongodb";

export const getAllCrewApplications = async (
    circleId: string,
): Promise<{
    pendingApplications: CrewApplication[];
    rejectedApplications: CrewApplication[];
}> => {
    if (!circleId) return { pendingApplications: [], rejectedApplications: [] };

    let objectId;
    try {
        objectId = new ObjectId(circleId);
    } catch (error) {
        console.error("Invalid circleId:", circleId);
        return { pendingApplications: [], rejectedApplications: [] };
    }

    const applications = await CrewApplications.aggregate([
        { $match: { circleId: objectId.toString() } },
        {
            $lookup: {
                from: "circles",
                localField: "userDid",
                foreignField: "did",
                as: "userDetails",
            },
        },
        { $unwind: "$userDetails" },
        {
            $project: {
                _id: { $toString: "$_id" },
                userDid: 1,
                circleId: 1,
                status: 1,
                requestedAt: 1,
                rejectedAt: 1,
                approvedAt: 1,
                message: 1,
                name: "$userDetails.name",
                email: "$userDetails.email",
                picture: "$userDetails.picture",
            },
        },
        { $sort: { requestedAt: -1 } }, // sort by most recent first
    ]).toArray();

    const pendingApplications = applications.filter((a) => a.status === "pending") as CrewApplication[];
    const rejectedApplications = applications.filter((a) => a.status === "rejected") as CrewApplication[];

    return { pendingApplications, rejectedApplications };
};

// Lightweight per-viewer existence check (no circle $lookup needed) — used to decide the Join
// Crew button's state for the current viewer, not to render a queue.
export const getUserPendingCrewApplication = async (
    userDid: string,
    circleId: string,
): Promise<CrewApplication | null> => {
    return await CrewApplications.findOne({ userDid, circleId, status: "pending" });
};

export const getCrewApplication = async (applicationId: string): Promise<CrewApplication> => {
    const application = await CrewApplications.findOne({ _id: new ObjectId(applicationId) });
    if (!application) {
        throw new Error("Crew application not found");
    }

    return application as CrewApplication;
};

export const createPendingCrewApplication = async (
    userDid: string,
    circleId: string,
    message: string,
): Promise<CrewApplication> => {
    const existingApplication = await CrewApplications.findOne({ userDid, circleId, status: "pending" });
    if (existingApplication) {
        throw new Error("A pending Crew application already exists for this user and circle");
    }

    const application: CrewApplication = {
        userDid,
        circleId,
        status: "pending",
        requestedAt: new Date(),
        message,
    };

    await CrewApplications.insertOne(application);
    return application;
};

export const updatePendingCrewApplicationStatus = async (
    applicationId: string,
    newStatus: "approved" | "rejected",
): Promise<CrewApplication> => {
    const application = await CrewApplications.findOne({ _id: new ObjectId(applicationId), status: "pending" });
    if (!application) {
        throw new Error("Pending crew application not found");
    }

    const update: Partial<CrewApplication> = {
        status: newStatus,
    };

    if (newStatus === "rejected") {
        update.rejectedAt = new Date();
    } else {
        update.approvedAt = new Date();
    }

    await CrewApplications.updateOne({ _id: new ObjectId(applicationId) }, { $set: update });

    return { ...application, ...update } as CrewApplication;
};
