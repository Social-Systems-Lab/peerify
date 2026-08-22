"use client";

import React, { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Circle, CrewApplication } from "@/models/models";
import { useToast } from "@/components/ui/use-toast";
import { approveCrewApplicationAction, rejectCrewApplicationAction } from "./actions";
import { Eye, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CirclePicture } from "@/components/modules/circles/circle-picture";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CrewApplicationsTableProps {
    circle: Circle;
    applications: CrewApplication[];
}

// Crew applications only ever carry a single free-text "How can I help?" answer, unlike Follow
// Requests' arbitrary circle.questionnaire — so this is a small purpose-built detail view rather
// than a stripped-down reuse of that multi-question dialog.
const CrewApplicationsTable: React.FC<CrewApplicationsTableProps> = ({ circle, applications }) => {
    const { toast } = useToast();
    const [loadingStates, setLoadingStates] = useState<{ [key: string]: boolean }>({});
    const [openDialogs, setOpenDialogs] = useState<{ [key: string]: boolean }>({});
    // Only reachable from the View Details dialog's Approve button — the row's quick-Approve
    // button stays a no-note shortcut for artists who don't want to write one.
    const [approvalNotes, setApprovalNotes] = useState<{ [key: string]: string }>({});

    const handleApprove = async (applicationId: string, note?: string) => {
        setLoadingStates((prev) => ({ ...prev, [applicationId]: true }));
        const result = await approveCrewApplicationAction(applicationId, circle, note);
        setLoadingStates((prev) => ({ ...prev, [applicationId]: false }));
        setOpenDialogs((prev) => ({ ...prev, [applicationId]: false }));

        if (result.success) {
            toast({ title: "Application Approved", description: result.message });
        } else {
            toast({ title: "Error", description: result.message, variant: "destructive" });
        }
    };

    const handleReject = async (applicationId: string) => {
        setLoadingStates((prev) => ({ ...prev, [applicationId]: true }));
        const result = await rejectCrewApplicationAction(applicationId, circle);
        setLoadingStates((prev) => ({ ...prev, [applicationId]: false }));
        setOpenDialogs((prev) => ({ ...prev, [applicationId]: false }));

        if (result.success) {
            toast({ title: "Application Rejected", description: result.message });
        } else {
            toast({ title: "Error", description: result.message, variant: "destructive" });
        }
    };

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Applicant</TableHead>
                    <TableHead>Applied At</TableHead>
                    <TableHead>Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {applications.length === 0 && (
                    <TableRow>
                        <TableCell colSpan={3} className="text-center">
                            No pending applications
                        </TableCell>
                    </TableRow>
                )}

                {applications.map((application) => (
                    <TableRow key={application._id}>
                        <TableCell>
                            <div className="flex items-center gap-2">
                                <CirclePicture
                                    circle={{ name: application.name, picture: application.picture as any }}
                                    size="32px"
                                />
                                <span>{application.name}</span>
                            </div>
                        </TableCell>
                        <TableCell>{new Date(application.requestedAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                            <div className="flex flex-row gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => handleApprove(application._id!)}
                                    disabled={loadingStates[application._id!]}
                                >
                                    {loadingStates[application._id!] ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        "Approve"
                                    )}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => handleReject(application._id!)}
                                    disabled={loadingStates[application._id!]}
                                >
                                    {loadingStates[application._id!] ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        "Reject"
                                    )}
                                </Button>
                                <Dialog
                                    open={openDialogs[application._id!]}
                                    onOpenChange={(open) =>
                                        setOpenDialogs((prev) => ({ ...prev, [application._id!]: open }))
                                    }
                                >
                                    <DialogTrigger asChild>
                                        <Button variant="outline" size="sm">
                                            <Eye className="mr-2 h-4 w-4" /> View Details
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent
                                        onInteractOutside={(e) => {
                                            e.preventDefault();
                                        }}
                                    >
                                        <DialogHeader>
                                            <DialogTitle>Crew Application Details</DialogTitle>
                                        </DialogHeader>
                                        <div className="flex items-center gap-3 py-2">
                                            <CirclePicture
                                                circle={{ name: application.name, picture: application.picture as any }}
                                                size="48px"
                                            />
                                            <div>
                                                <p className="font-semibold">{application.name}</p>
                                                <p className="text-sm text-muted-foreground">
                                                    Applied {new Date(application.requestedAt).toLocaleString()}
                                                </p>
                                            </div>
                                        </div>
                                        <div>
                                            <h3 className="mb-2 font-semibold">How can I help?</h3>
                                            <p className="whitespace-pre-wrap text-sm">{application.message}</p>
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor={`approval-note-${application._id}`}>
                                                Note to {application.name} (optional)
                                            </Label>
                                            <Textarea
                                                id={`approval-note-${application._id}`}
                                                value={approvalNotes[application._id!] || ""}
                                                onChange={(e) =>
                                                    setApprovalNotes((prev) => ({
                                                        ...prev,
                                                        [application._id!]: e.target.value,
                                                    }))
                                                }
                                                placeholder="Add a personal note to include with the approval notification…"
                                                maxLength={500}
                                                className="min-h-[80px]"
                                            />
                                        </div>
                                        <DialogFooter className="sm:justify-start">
                                            <Button
                                                variant="default"
                                                onClick={() =>
                                                    handleApprove(application._id!, approvalNotes[application._id!])
                                                }
                                                disabled={loadingStates[application._id!]}
                                            >
                                                {loadingStates[application._id!] ? (
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                    "Approve"
                                                )}
                                            </Button>
                                            <Button
                                                variant="destructive"
                                                onClick={() => handleReject(application._id!)}
                                                disabled={loadingStates[application._id!]}
                                            >
                                                {loadingStates[application._id!] ? (
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                    "Reject"
                                                )}
                                            </Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
};

export default CrewApplicationsTable;
