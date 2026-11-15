"use client";

// The event page's crew panel (Crew R1, item 3): the event's shifts and tasks, as the organiser's
// day-of status page. Everyone who may see a shift gets its time, slots and counts and their own
// sign-up status; organisers also see who signed up. Hidden when the host circle has neither Tasks
// nor Shifts on, for signed-out visitors, and when the viewer can see no shift or task and can
// create none (e.g. a follower who isn't crew; 2026-11-15). All shaping happens on the server
// (getEventCrewPanelAction).

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getEventCrewPanelAction, type EventCrewPanelResult } from "@/app/circles/[handle]/events/actions";
import { CreateShiftDialog } from "@/components/global-create/create-shift-dialog";
import { formatShiftWhen, type EventCrewShift, type EventCrewTask } from "@/lib/tasks/event-crew-panel";

type Props = {
    circleHandle: string;
    circleId?: string;
    eventId: string;
    // Prefills the "Create shift" date.
    eventStartAt?: Date | string;
};

const getStageInfo = (stage?: EventCrewTask["stage"]) => {
    switch (stage) {
        case "review":
            return { className: "bg-yellow-200 text-yellow-800", text: "Review" };
        case "open":
            return { className: "bg-blue-200 text-blue-800", text: "Open" };
        case "inProgress":
            return { className: "bg-orange-200 text-orange-800", text: "In Progress" };
        case "resolved":
            return { className: "bg-green-200 text-green-800", text: "Resolved" };
        default:
            return { className: "bg-gray-200 text-gray-800", text: stage || "Unknown" };
    }
};

const toIsoDate = (value?: Date | string) => {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

function ShiftRow({ circleHandle, shift }: { circleHandle: string; shift: EventCrewShift }) {
    const openPlaces = Math.max(shift.slots - shift.confirmedCount - shift.pendingCount, 0);
    return (
        <div className="rounded-md border bg-white px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                    href={`/circles/${circleHandle}/shifts/${shift.id}`}
                    className="font-medium text-blue-600 hover:underline"
                >
                    {shift.title}
                </Link>
                <div className="flex items-center gap-1">
                    {shift.crewOnly && <Badge variant="outline">Crew only</Badge>}
                    {shift.viewerStatus === "confirmed" && (
                        <Badge className="bg-green-200 text-green-800">You: confirmed</Badge>
                    )}
                    {shift.viewerStatus === "pending" && (
                        <Badge className="bg-yellow-200 text-yellow-800">You: pending</Badge>
                    )}
                </div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{formatShiftWhen(shift)}</div>
            <div className="mt-1 text-xs">
                {shift.confirmedCount} / {shift.slots} confirmed
                {shift.pendingCount > 0 && ` · ${shift.pendingCount} pending`}
                {openPlaces > 0 && (
                    <span className="text-red-600">
                        {" "}
                        · {openPlaces} {openPlaces === 1 ? "place" : "places"} open
                    </span>
                )}
            </div>
            {shift.people && shift.people.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs">
                    {shift.people.map((person) => (
                        <li key={person.did} className="flex items-center gap-2">
                            {person.handle ? (
                                <Link href={`/circles/${person.handle}`} className="hover:underline">
                                    {person.name || person.handle}
                                </Link>
                            ) : (
                                <span>{person.name || "Someone"}</span>
                            )}
                            <span className={person.status === "confirmed" ? "text-green-700" : "text-yellow-700"}>
                                {person.status}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default function EventTasksPanel({ circleHandle, circleId, eventId, eventStartAt }: Props) {
    const [panel, setPanel] = useState<EventCrewPanelResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false);
    const router = useRouter();

    const load = useCallback(async () => {
        try {
            setPanel(await getEventCrewPanelAction(circleHandle, eventId));
        } finally {
            setLoading(false);
        }
    }, [circleHandle, eventId]);

    useEffect(() => {
        void load();
    }, [load]);

    if (loading || !panel?.show) {
        return null;
    }

    const hasAnything = panel.shifts.length > 0 || panel.tasks.length > 0;

    return (
        <div className="rounded-lg border bg-white/70 p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium text-muted-foreground">Crew, shifts and tasks</div>
                <div className="flex gap-2">
                    {panel.canCreateShift && (
                        <Button size="sm" onClick={() => setIsShiftDialogOpen(true)}>
                            Create shift
                        </Button>
                    )}
                    {panel.canCreateTask && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => router.push(`/circles/${circleHandle}/tasks/create?eventId=${eventId}`)}
                        >
                            Create task
                        </Button>
                    )}
                </div>
            </div>

            {!hasAnything ? (
                <div className="text-sm text-muted-foreground">No shifts or tasks linked yet.</div>
            ) : (
                <div className="space-y-4">
                    {panel.shifts.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Shifts</div>
                            {panel.shifts.map((shift) => (
                                <ShiftRow key={shift.id} circleHandle={circleHandle} shift={shift} />
                            ))}
                        </div>
                    )}
                    {panel.tasks.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Tasks</div>
                            {panel.tasks.map((task) => {
                                const stageInfo = getStageInfo(task.stage);
                                return (
                                    <div
                                        key={task.id}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white px-3 py-2"
                                    >
                                        <div>
                                            <Link
                                                href={`/circles/${circleHandle}/tasks/${task.id}`}
                                                className="font-medium text-blue-600 hover:underline"
                                            >
                                                {task.title}
                                            </Link>
                                            <div className="text-xs text-muted-foreground">
                                                {task.assigneeName
                                                    ? `Assigned to ${task.assigneeName}`
                                                    : "Not assigned"}
                                                {task.targetDate &&
                                                    ` · due ${format(new Date(task.targetDate), "d MMM")}`}
                                            </div>
                                        </div>
                                        <Badge className={stageInfo.className}>{stageInfo.text}</Badge>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {panel.canCreateShift && (
                <CreateShiftDialog
                    isOpen={isShiftDialogOpen}
                    onOpenChange={setIsShiftDialogOpen}
                    onSuccess={() => void load()}
                    initialSelectedCircleId={circleId}
                    initialEventId={eventId}
                    initialTargetDate={toIsoDate(eventStartAt)}
                />
            )}
        </div>
    );
}
