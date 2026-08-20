import { EventHostChangeRequest } from "@/models/models";
import { EventHostChangeRequests } from "./db";
import { ObjectId } from "mongodb";

export const getPendingEventHostChangeRequestForEvent = async (
    eventId: string,
): Promise<EventHostChangeRequest | null> => {
    const request = await EventHostChangeRequests.findOne({ eventId, status: "pending" });
    return (request as EventHostChangeRequest) ?? null;
};

export const getPendingEventHostChangeRequestsForCircle = async (
    circleId: string,
): Promise<EventHostChangeRequest[]> => {
    if (!circleId) return [];
    const requests = await EventHostChangeRequests.find({ toCircleId: circleId, status: "pending" })
        .sort({ requestedAt: -1 })
        .toArray();
    return requests as EventHostChangeRequest[];
};

export const getEventHostChangeRequest = async (requestId: string): Promise<EventHostChangeRequest> => {
    const request = await EventHostChangeRequests.findOne({ _id: new ObjectId(requestId) });
    if (!request) {
        throw new Error("Event host change request not found");
    }
    return request as EventHostChangeRequest;
};

export const createPendingEventHostChangeRequest = async (
    eventId: string,
    fromCircleId: string,
    toCircleId: string,
    requestedBy: string,
): Promise<EventHostChangeRequest> => {
    const existingRequest = await EventHostChangeRequests.findOne({ eventId, status: "pending" });
    if (existingRequest) {
        throw new Error("A pending host-change request already exists for this event");
    }

    const request: EventHostChangeRequest = {
        eventId,
        fromCircleId,
        toCircleId,
        requestedBy,
        status: "pending",
        requestedAt: new Date(),
    };

    await EventHostChangeRequests.insertOne(request);
    return request;
};

export const updateEventHostChangeRequestStatus = async (
    requestId: string,
    newStatus: "approved" | "rejected",
): Promise<EventHostChangeRequest> => {
    const request = await EventHostChangeRequests.findOne({ _id: new ObjectId(requestId), status: "pending" });
    if (!request) {
        throw new Error("Pending event host change request not found");
    }

    const update: Partial<EventHostChangeRequest> = { status: newStatus };
    if (newStatus === "rejected") {
        update.rejectedAt = new Date();
    } else {
        update.approvedAt = new Date();
    }

    await EventHostChangeRequests.updateOne({ _id: new ObjectId(requestId) }, { $set: update });
    return { ...request, ...update } as EventHostChangeRequest;
};
