"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { PeerifyPledgeRecord } from "@/lib/data/peerify-pledges";

const getCityAreaLabel = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
        return "Unspecified area";
    }

    const looksAddressLike =
        /^\d+\s+\S+/.test(trimmed) ||
        /\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|square|sq)\b/i.test(trimmed);
    const parts = trimmed
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

    if (
        parts.length > 1 &&
        (/^\d+\s+\S+/.test(parts[0]) ||
            /\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|square|sq)\b/i.test(parts[0]))
    ) {
        return parts.slice(1).join(", ");
    }

    if (looksAddressLike) {
        return "City/area provided";
    }

    return trimmed;
};

const formatDate = (date: Date): string =>
    new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(new Date(date));

const sortByMostRecent = (pledges: PeerifyPledgeRecord[]): PeerifyPledgeRecord[] =>
    [...pledges].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

type PledgeDashboardClientProps = {
    pledges: PeerifyPledgeRecord[];
};

export function PledgeDashboardClient({ pledges }: PledgeDashboardClientProps) {
    const sortedPledges = sortByMostRecent(pledges);

    return (
        <Card className="rounded-lg border-slate-200 bg-white shadow-none">
            <CardContent className="divide-y divide-slate-100 p-0">
                {sortedPledges.map((pledge) => (
                    <PledgeRow key={pledge._id} pledge={pledge} />
                ))}
            </CardContent>
        </Card>
    );
}

function PledgeRow({ pledge }: { pledge: PeerifyPledgeRecord }) {
    return (
        <div className="flex w-full items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-[#231f1a]">
                        {pledge.pledgerName || "Unknown supporter"}
                    </span>
                    {pledge.pledgerHandle ? (
                        <span className="shrink-0 truncate text-xs text-muted-foreground">@{pledge.pledgerHandle}</span>
                    ) : null}
                </div>
                <div className="mt-0.5 truncate text-sm text-slate-500">{getCityAreaLabel(pledge.fanLocation)}</div>
            </div>
            <div className="shrink-0 text-sm font-medium text-[#231f1a]">{pledge.maximumTicketAmount || "-"}</div>
            <div className="hidden shrink-0 text-sm text-slate-500 sm:block">{formatDate(pledge.createdAt)}</div>
        </div>
    );
}
