"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Circle, CrewApplication } from "@/models/models";
import CrewApplicationsTable from "./crew-applications-table";
import RejectedCrewApplicationsTable from "./rejected-crew-applications-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsCompact } from "@/components/utils/use-is-compact";

interface CrewApplicationsGatewayProps {
    circle: Circle;
    pendingApplications: CrewApplication[];
    rejectedApplications: CrewApplication[];
}

const CrewApplicationsGateway: React.FC<CrewApplicationsGatewayProps> = ({
    circle,
    pendingApplications,
    rejectedApplications,
}) => {
    const isCompact = useIsCompact();

    return (
        <div
            className="flex h-full flex-1 items-start justify-center"
            style={{
                flexGrow: isCompact ? "1" : "3",
                maxWidth: isCompact ? "none" : "1000px",
            }}
        >
            <div className="flex flex-1 flex-row items-center justify-center pb-8 pl-6 pr-6">
                <div className="flex flex-1 flex-col">
                    <h1 className="m-0 p-0 pb-3 text-3xl font-bold">Crew Applications</h1>
                    <p className="text-gray-500">Manage and control incoming Crew applications.</p>
                    {/* Discoverability fix: the welcome message field itself still lives in About
                        settings (no duplicate field/save path) — this just points people here first,
                        since Crew Applications is the natural first stop when setting up Crew. */}
                    <Link
                        href={`/circles/${circle.handle}/settings/about#crew-welcome-message`}
                        className="mb-8 mt-2 inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                        Edit your Crew welcome message
                        <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                    <Tabs defaultValue="pending" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="pending">Pending Applications</TabsTrigger>
                            <TabsTrigger value="rejected">Rejected Applications</TabsTrigger>
                        </TabsList>
                        <TabsContent value="pending">
                            <CrewApplicationsTable circle={circle} applications={pendingApplications} />
                        </TabsContent>
                        <TabsContent value="rejected">
                            <RejectedCrewApplicationsTable circle={circle} applications={rejectedApplications} />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
};

export default CrewApplicationsGateway;
