"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { PeerifyPledgeRecord } from "@/lib/data/peerify-pledges";
import { Flame, HandHeart } from "lucide-react";

// A location needs at least this many pledges before it's promoted from the plain list into
// its own highlighted Momentum card (Layer 3). Named/exported so the threshold is easy to tune
// without hunting for a magic number in the grouping logic below.
export const MOMENTUM_THRESHOLD = 3;

const parseTicketAmount = (value: string): number => {
    const normalized = value.replace(/[^0-9.]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};

const formatEstimatedTicketValue = (value: number): string => (value > 0 ? value.toLocaleString("en") : "-");

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

type PledgeLocationCluster = {
    label: string;
    pledgeCount: number;
    estimatedTicketValue: number;
    helpOfferCount: number;
    helpOptions: Array<{ label: string; count: number }>;
};

const buildLocationClusters = (pledges: PeerifyPledgeRecord[]): PledgeLocationCluster[] => {
    const clusters = new Map<string, PledgeLocationCluster>();

    pledges.forEach((pledge) => {
        const label = getCityAreaLabel(pledge.fanLocation);
        const existing =
            clusters.get(label) ??
            ({
                label,
                pledgeCount: 0,
                estimatedTicketValue: 0,
                helpOfferCount: 0,
                helpOptions: [],
            } satisfies PledgeLocationCluster);
        const helpCounts = new Map(existing.helpOptions.map((option) => [option.label, option.count]));

        existing.pledgeCount += 1;
        existing.estimatedTicketValue += parseTicketAmount(pledge.maximumTicketAmount);

        if (pledge.helpOptions.length > 0) {
            existing.helpOfferCount += 1;
        }

        pledge.helpOptions.forEach((option) => {
            helpCounts.set(option, (helpCounts.get(option) ?? 0) + 1);
        });

        existing.helpOptions = Array.from(helpCounts.entries())
            .map(([optionLabel, count]) => ({ label: optionLabel, count }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

        clusters.set(label, existing);
    });

    return Array.from(clusters.values()).sort(
        (a, b) =>
            b.pledgeCount - a.pledgeCount ||
            b.estimatedTicketValue - a.estimatedTicketValue ||
            a.label.localeCompare(b.label),
    );
};

const sortByMostRecent = (pledges: PeerifyPledgeRecord[]): PeerifyPledgeRecord[] =>
    [...pledges].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

type PledgeDashboardClientProps = {
    pledges: PeerifyPledgeRecord[];
};

export function PledgeDashboardClient({ pledges }: PledgeDashboardClientProps) {
    const clusters = useMemo(() => buildLocationClusters(pledges), [pledges]);
    const momentumClusters = useMemo(
        () => clusters.filter((cluster) => cluster.pledgeCount >= MOMENTUM_THRESHOLD),
        [clusters],
    );
    const momentumLabels = useMemo(() => new Set(momentumClusters.map((cluster) => cluster.label)), [momentumClusters]);

    // Pledges belonging to a momentum-qualifying location live only inside that Momentum card
    // (see item 3) — the plain list only shows what's left over below the threshold.
    const plainListPledges = useMemo(
        () => sortByMostRecent(pledges.filter((pledge) => !momentumLabels.has(getCityAreaLabel(pledge.fanLocation)))),
        [pledges, momentumLabels],
    );

    return (
        <div className="flex flex-col gap-4">
            {momentumClusters.map((cluster) => (
                <MomentumCard key={cluster.label} cluster={cluster} />
            ))}

            {plainListPledges.length > 0 ? (
                <Card className="rounded-lg border-slate-200 bg-white shadow-none">
                    <CardContent className="divide-y divide-slate-100 p-0">
                        {plainListPledges.map((pledge) => (
                            <PledgeRow key={pledge._id} pledge={pledge} />
                        ))}
                    </CardContent>
                </Card>
            ) : null}
        </div>
    );
}

function MomentumCard({ cluster }: { cluster: PledgeLocationCluster }) {
    const helpSummary =
        cluster.helpOfferCount > 0
            ? `${cluster.helpOfferCount} ${cluster.helpOfferCount === 1 ? "person" : "people"} offering: ${cluster.helpOptions
                  .slice(0, 3)
                  .map((option) => option.label)
                  .join(", ")}`
            : "No help offers yet";

    return (
        <Card className="overflow-hidden rounded-lg border-2 border-amber-200 bg-amber-50/60 shadow-none">
            <div className="flex items-start gap-4 p-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500 text-sm font-semibold text-white">
                    {cluster.pledgeCount}
                </span>
                <div>
                    <div className="flex items-center gap-2">
                        <Flame className="h-4 w-4 text-amber-600" />
                        <h3 className="font-semibold text-[#231f1a]">{cluster.label}</h3>
                        <Badge variant="secondary" className="rounded-full">
                            Momentum
                        </Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                        {cluster.pledgeCount} pledges &middot; ~{formatEstimatedTicketValue(cluster.estimatedTicketValue)}{" "}
                        estimated value
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                        <HandHeart className="h-3.5 w-3.5" />
                        {helpSummary}
                    </p>
                </div>
            </div>
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
