"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Circle } from "@/models/models";
import {
    approveEventHostChangeRequestAction,
    rejectEventHostChangeRequestAction,
    EventHostChangeRequestDisplay,
} from "@/app/circles/[handle]/events/actions";
import { format } from "date-fns";

type Props = {
    circle: Circle;
    requests: EventHostChangeRequestDisplay[];
};

const EventHostRequests: React.FC<Props> = ({ circle, requests: initialRequests }) => {
    const { toast } = useToast();
    const [requests, setRequests] = useState(initialRequests);
    const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});

    const decide = async (requestId: string, action: "approve" | "reject") => {
        setLoadingIds((prev) => ({ ...prev, [requestId]: true }));
        const result =
            action === "approve"
                ? await approveEventHostChangeRequestAction(requestId)
                : await rejectEventHostChangeRequestAction(requestId);
        setLoadingIds((prev) => ({ ...prev, [requestId]: false }));

        if (result.success) {
            setRequests((prev) => prev.filter((r) => r._id !== requestId));
            toast({ title: action === "approve" ? "Request approved" : "Request rejected", description: result.message });
        } else {
            toast({ title: "Error", description: result.message, variant: "destructive" });
        }
    };

    return (
        <div className="flex h-full flex-1 items-start justify-center">
            <div className="flex flex-1 flex-row items-center justify-center pb-8 pl-6 pr-6">
                <div className="flex w-full max-w-2xl flex-1 flex-col">
                    <h1 className="m-0 p-0 pb-3 text-3xl font-bold">Event Host Requests</h1>
                    <p className="pb-8 text-gray-500">
                        Other hosts have asked to move an event to {circle.name || circle.handle}. Approving moves
                        the event here immediately — its RSVPs, comments, and tasks stay exactly as they are.
                    </p>

                    {requests.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No pending requests.</p>
                    ) : (
                        <div className="space-y-3">
                            {requests.map((request) => (
                                <div
                                    key={request._id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                                >
                                    <div>
                                        <div className="font-medium">{request.eventTitle || "Untitled event"}</div>
                                        <div className="text-sm text-muted-foreground">
                                            From {request.fromCircleName || "an unknown circle"}, requested by{" "}
                                            {request.requesterName || "someone"} on{" "}
                                            {format(new Date(request.requestedAt), "MMM d, yyyy")}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            disabled={loadingIds[request._id]}
                                            onClick={() => decide(request._id, "reject")}
                                        >
                                            Reject
                                        </Button>
                                        <Button
                                            disabled={loadingIds[request._id]}
                                            onClick={() => decide(request._id, "approve")}
                                        >
                                            Approve
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EventHostRequests;
