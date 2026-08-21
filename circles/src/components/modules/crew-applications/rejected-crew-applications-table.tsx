"use client";

import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Circle, CrewApplication } from "@/models/models";

interface RejectedCrewApplicationsTableProps {
    circle: Circle;
    applications: CrewApplication[];
}

const RejectedCrewApplicationsTable: React.FC<RejectedCrewApplicationsTableProps> = ({ applications }) => {
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Applicant</TableHead>
                    <TableHead>Rejected At</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {applications.length === 0 && (
                    <TableRow>
                        <TableCell colSpan={2} className="text-center">
                            No rejected applications
                        </TableCell>
                    </TableRow>
                )}

                {applications.map((application) => (
                    <TableRow key={application._id}>
                        <TableCell>{application.name}</TableCell>
                        <TableCell>{new Date(application.rejectedAt!).toLocaleDateString()}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
};

export default RejectedCrewApplicationsTable;
