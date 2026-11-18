"use client";

// The Crew page's "Shifts & tasks" panel (Crew round 2, 2026-11-18; F7: top of the left column, above
// the feed). "My shifts" always shows; "Open shifts" by event shows the next 5 rows with "Show all".
// Organisers (tasks.assign / tasks.moderate, so moderators too, F6) also get "Review sign-ups" with
// names; the Crew Dashboard shows only that ("dashboard" variant). Sign-up, confirm and decline stay on the shift and task pages: rows only link there. All
// shaping happens on the server (getCrewShiftsAndTasksAction); this only renders what it was given.

import React, { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CrewShiftsAndTasksResult } from "./actions";
import { formatShiftPlaces } from "@/components/modules/tasks/shift-task-utils";
import { formatShiftWhen } from "@/lib/tasks/event-crew-panel";
import type { CrewViewGroup, CrewViewItem, CrewViewShift, CrewViewTask } from "@/lib/tasks/crew-shifts-view";

const OPEN_ROWS_SHOWN = 5;

type Props = {
    circleHandle: string;
    data: CrewShiftsAndTasksResult;
    // "dashboard": the Crew Dashboard's organiser view only ("Review sign-ups"; F6, admins only).
    variant?: "crewPage" | "dashboard";
};

const itemHref = (circleHandle: string, item: CrewViewItem) =>
    `/circles/${circleHandle}/${item.kind === "shift" ? "shifts" : "tasks"}/${item.id}`;

const formatTaskWhen = (task: CrewViewTask) => {
    if (!task.targetDate) return "No date set";
    const date = new Date(task.targetDate);
    return Number.isNaN(date.getTime()) ? "No date set" : format(date, "EEE d MMM");
};

const formatEventWhen = (startAt: string) => {
    const date = new Date(startAt);
    return Number.isNaN(date.getTime()) ? "" : format(date, "EEE d MMM");
};

function StatusBadge({ item }: { item: CrewViewItem }) {
    switch (item.viewerStatus) {
        case "confirmed":
            return <Badge className="bg-green-200 text-green-800">You: confirmed</Badge>;
        case "pending":
            return <Badge className="bg-yellow-200 text-yellow-800">You: pending</Badge>;
        case "waitingList":
            return <Badge className="bg-yellow-200 text-yellow-800">You: waiting list</Badge>;
        case "assigned":
            return <Badge className="bg-green-200 text-green-800">You: assigned</Badge>;
        case "claimPending":
            return <Badge className="bg-yellow-200 text-yellow-800">You: offered</Badge>;
        default:
            return null;
    }
}

function ShiftRow({ circleHandle, shift, review }: { circleHandle: string; shift: CrewViewShift; review?: boolean }) {
    const href = itemHref(circleHandle, shift);
    return (
        <div className="rounded-md border bg-white px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={href} className="font-medium text-blue-600 hover:underline">
                    {shift.title}
                </Link>
                <div className="flex items-center gap-1">
                    {shift.crewOnly && <Badge variant="outline">Crew only</Badge>}
                    <StatusBadge item={shift} />
                </div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{formatShiftWhen(shift)}</div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>
                    {formatShiftPlaces(shift.slots, shift.confirmedCount)}
                    {review && shift.pendingCount ? ` · ${shift.pendingCount} pending` : ""}
                </span>
                {review && (
                    <Link href={href} className="font-medium text-blue-600 hover:underline">
                        Review
                    </Link>
                )}
            </div>
            {review && shift.people && shift.people.length > 0 && (
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
                            <span
                                className={person.status === "confirmed" ? "text-green-700" : "text-muted-foreground"}
                            >
                                {person.status === "confirmed" ? "confirmed" : "pending"}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function TaskRow({ circleHandle, task, review }: { circleHandle: string; task: CrewViewTask; review?: boolean }) {
    const href = itemHref(circleHandle, task);
    const offers = task.pendingClaimCount ?? 0;
    return (
        <div className="rounded-md border bg-white px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={href} className="font-medium text-blue-600 hover:underline">
                    {task.title}
                </Link>
                <div className="flex items-center gap-1">
                    <Badge variant="outline">Task</Badge>
                    <StatusBadge item={task} />
                </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                    {formatTaskWhen(task)}
                    {review && task.assigneeName ? ` · ${task.assigneeName}` : ""}
                    {review && offers > 0 ? ` · ${offers} ${offers === 1 ? "offer" : "offers"}` : ""}
                </span>
                {review ? (
                    <Link href={href} className="font-medium text-blue-600 hover:underline">
                        Review
                    </Link>
                ) : (
                    !task.viewerStatus && (
                        <Link href={href} className="font-medium text-blue-600 hover:underline">
                            Offer to help
                        </Link>
                    )
                )}
            </div>
        </div>
    );
}

function Row({ circleHandle, item, review }: { circleHandle: string; item: CrewViewItem; review?: boolean }) {
    return item.kind === "shift" ? (
        <ShiftRow circleHandle={circleHandle} shift={item} review={review} />
    ) : (
        <TaskRow circleHandle={circleHandle} task={item} review={review} />
    );
}

// Groups with their rows, cut after `limit` rows in total (headings only for groups that keep a row).
const takeRows = (groups: CrewViewGroup[], limit: number) => {
    let left = limit;
    const shown: { group: CrewViewGroup; items: CrewViewItem[] }[] = [];
    for (const group of groups) {
        if (left <= 0) break;
        const items = [...group.shifts, ...group.tasks].slice(0, left);
        left -= items.length;
        if (items.length > 0) shown.push({ group, items });
    }
    return shown;
};
const countRows = (groups: CrewViewGroup[]) => groups.reduce((n, g) => n + g.shifts.length + g.tasks.length, 0);

function GroupedList({
    circleHandle,
    groups,
    review,
    emptyText,
}: {
    circleHandle: string;
    groups: CrewViewGroup[];
    review?: boolean;
    emptyText: string;
}) {
    const [showAll, setShowAll] = useState(false);
    const total = countRows(groups);
    if (total === 0) return <div className="text-sm text-muted-foreground">{emptyText}</div>;
    const shown = takeRows(groups, showAll ? total : OPEN_ROWS_SHOWN);
    return (
        <div className="space-y-3">
            {shown.map(({ group, items }) => (
                <div key={group.event?.id ?? "other"} className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {group.event
                            ? `${group.event.title} · ${formatEventWhen(group.event.startAt)}`
                            : "Other shifts"}
                    </div>
                    {items.map((item) => (
                        <Row key={`${item.kind}-${item.id}`} circleHandle={circleHandle} item={item} review={review} />
                    ))}
                </div>
            ))}
            {total > OPEN_ROWS_SHOWN && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>
                    {showAll ? "Show fewer" : `Show all (${total})`}
                </Button>
            )}
        </div>
    );
}

export default function CrewShiftsPanel({ circleHandle, data, variant = "crewPage" }: Props) {
    if (!data.show) return null;

    if (variant === "dashboard") {
        if (!data.isOrganiser || !data.allByEvent) return null;
        return (
            <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <h2 className="text-xl font-semibold text-[#231f1a]">Shifts &amp; tasks</h2>
                <h3 className="text-sm font-semibold text-foreground">Review sign-ups</h3>
                <GroupedList
                    circleHandle={circleHandle}
                    groups={data.allByEvent}
                    review
                    emptyText="Nothing coming up to review."
                />
            </section>
        );
    }

    return (
        <div className="space-y-5 rounded-[15px] bg-white p-4 shadow-lg">
            <h2 className="text-lg font-semibold">Shifts &amp; tasks</h2>

            <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">My shifts</h3>
                {data.myShifts.length > 0 ? (
                    <div className="space-y-2">
                        {data.myShifts.map((item) => (
                            <Row key={`${item.kind}-${item.id}`} circleHandle={circleHandle} item={item} />
                        ))}
                    </div>
                ) : (
                    <div className="text-sm text-muted-foreground">
                        You haven&apos;t signed up for anything coming up.
                    </div>
                )}
            </section>

            <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Open shifts</h3>
                <GroupedList
                    circleHandle={circleHandle}
                    groups={data.openByEvent}
                    emptyText="No open shifts right now."
                />
            </section>

            {data.isOrganiser && data.allByEvent && (
                <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground">Review sign-ups</h3>
                    <GroupedList
                        circleHandle={circleHandle}
                        groups={data.allByEvent}
                        review
                        emptyText="Nothing coming up to review."
                    />
                </section>
            )}
        </div>
    );
}
