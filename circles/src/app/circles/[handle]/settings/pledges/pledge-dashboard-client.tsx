"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { findOrCreateDMConversationAction } from "@/components/modules/chat/actions";
import type { Circle } from "@/models/models";
import type { PeerifyPledgeRecord } from "@/lib/data/peerify-pledges";
import { ChevronDown, ChevronRight, Flame, HandHeart, Loader2, MapPinned, Users } from "lucide-react";
import { TbMessage } from "react-icons/tb";

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

const getLocationClusterId = (label: string): string =>
    `pledge-location-${
        label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "area"
    }`;

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
    const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
    const [detailPledgeId, setDetailPledgeId] = useState<string | null>(null);

    const clusters = useMemo(() => buildLocationClusters(pledges), [pledges]);
    const momentumClusters = useMemo(
        () => clusters.filter((cluster) => cluster.pledgeCount >= MOMENTUM_THRESHOLD),
        [clusters],
    );
    const momentumLabels = useMemo(() => new Set(momentumClusters.map((cluster) => cluster.label)), [momentumClusters]);

    const pledgesByLocation = useMemo(() => {
        const map = new Map<string, PeerifyPledgeRecord[]>();
        pledges.forEach((pledge) => {
            const label = getCityAreaLabel(pledge.fanLocation);
            map.set(label, [...(map.get(label) ?? []), pledge]);
        });
        map.forEach((list, label) => map.set(label, sortByMostRecent(list)));
        return map;
    }, [pledges]);

    // Pledges belonging to a momentum-qualifying location live only inside that Momentum card
    // (see item 3) — the plain list only shows what's left over below the threshold.
    const plainListPledges = useMemo(
        () => sortByMostRecent(pledges.filter((pledge) => !momentumLabels.has(getCityAreaLabel(pledge.fanLocation)))),
        [pledges, momentumLabels],
    );

    const detailPledge = useMemo(
        () => pledges.find((pledge) => pledge._id === detailPledgeId) ?? null,
        [pledges, detailPledgeId],
    );

    const toggleCluster = (label: string) => {
        setExpandedClusters((prev) => {
            const next = new Set(prev);
            if (next.has(label)) {
                next.delete(label);
            } else {
                next.add(label);
            }
            return next;
        });
    };

    return (
        <div className="flex flex-col gap-6">
            <h2 className="text-lg font-semibold text-[#231f1a]">Pledges</h2>

            <div className="flex flex-col gap-4">
                {momentumClusters.map((cluster) => (
                    <MomentumCard
                        key={cluster.label}
                        cluster={cluster}
                        pledges={pledgesByLocation.get(cluster.label) ?? []}
                        expanded={expandedClusters.has(cluster.label)}
                        onToggle={() => toggleCluster(cluster.label)}
                        onSelectPledge={setDetailPledgeId}
                    />
                ))}

                {plainListPledges.length > 0 ? (
                    <Card className="rounded-lg border-slate-200 bg-white shadow-none">
                        <CardContent className="divide-y divide-slate-100 p-0">
                            {plainListPledges.map((pledge) => (
                                <PledgeRow
                                    key={pledge._id}
                                    pledge={pledge}
                                    onSelect={() => setDetailPledgeId(pledge._id ?? null)}
                                />
                            ))}
                        </CardContent>
                    </Card>
                ) : null}
            </div>

            <PledgeDetailDialog
                pledge={detailPledge}
                onOpenChange={(open) => {
                    if (!open) setDetailPledgeId(null);
                }}
            />
        </div>
    );
}

function MomentumCard({
    cluster,
    pledges,
    expanded,
    onToggle,
    onSelectPledge,
}: {
    cluster: PledgeLocationCluster;
    pledges: PeerifyPledgeRecord[];
    expanded: boolean;
    onToggle: () => void;
    onSelectPledge: (id: string | null) => void;
}) {
    const helpSummary =
        cluster.helpOfferCount > 0
            ? `${cluster.helpOfferCount} ${cluster.helpOfferCount === 1 ? "person" : "people"} offering: ${cluster.helpOptions
                  .slice(0, 3)
                  .map((option) => option.label)
                  .join(", ")}`
            : "No help offers yet";

    return (
        <Card className="overflow-hidden rounded-lg border-2 border-amber-200 bg-amber-50/60 shadow-none">
            <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-4 p-4 text-left">
                <div className="flex items-start gap-3">
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
                {expanded ? (
                    <ChevronDown className="h-5 w-5 shrink-0 text-slate-500" />
                ) : (
                    <ChevronRight className="h-5 w-5 shrink-0 text-slate-500" />
                )}
            </button>
            {expanded ? (
                <div className="divide-y divide-amber-100 border-t border-amber-100 bg-white">
                    {pledges.map((pledge) => (
                        <PledgeRow
                            key={pledge._id}
                            pledge={pledge}
                            onSelect={() => onSelectPledge(pledge._id ?? null)}
                        />
                    ))}
                </div>
            ) : null}
        </Card>
    );
}

function PledgeRow({ pledge, onSelect }: { pledge: PeerifyPledgeRecord; onSelect: () => void }) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect();
                }
            }}
            className="flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left transition hover:bg-slate-50"
        >
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
            <MessagePledgerButton pledge={pledge} />
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
        </div>
    );
}

function MessagePledgerButton({ pledge, compact = true }: { pledge: PeerifyPledgeRecord; compact?: boolean }) {
    const router = useRouter();
    const { toast } = useToast();
    const [isSending, setIsSending] = useState(false);

    const handleClick = async (event: React.MouseEvent) => {
        event.stopPropagation();
        if (!pledge.pledgerDid || isSending) {
            return;
        }

        setIsSending(true);
        try {
            // Reuses the same DM-creation action MessageButton uses on profile pages
            // (source: "profile" skips the contacts-only eligibility gate) — no new
            // messaging infrastructure, just a lighter-weight trigger for a compact row.
            const recipient: Circle = { did: pledge.pledgerDid };
            const result = await findOrCreateDMConversationAction(recipient, { source: "profile" });
            const conversationId = result.chatRoom?._id || result.chatRoom?.handle;
            if (!result.success || !conversationId) {
                toast({
                    title: "Message",
                    description: result.message || "Could not open the direct message",
                    variant: "destructive",
                });
                return;
            }

            router.push(`/chat/${conversationId}`);
        } catch (error) {
            console.error("Failed to open pledge DM:", error);
            toast({
                title: "Message",
                description: error instanceof Error ? error.message : "Could not open the direct message",
                variant: "destructive",
            });
        } finally {
            setIsSending(false);
        }
    };

    return (
        <Button
            type="button"
            variant={compact ? "ghost" : "outline"}
            size={compact ? "icon" : "default"}
            className={cn("shrink-0", compact ? "rounded-full text-slate-500 hover:text-[#231f1a]" : "gap-2 rounded-full")}
            disabled={isSending}
            onClick={handleClick}
            aria-label={compact ? `Message ${pledge.pledgerName || "this pledger"}` : undefined}
        >
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <TbMessage className="h-4 w-4" />}
            {!compact ? (isSending ? "Opening..." : "Message") : null}
        </Button>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-medium uppercase text-slate-500">{label}</span>
            <span className="text-right text-slate-700">{value}</span>
        </div>
    );
}

function PledgeDetailDialog({
    pledge,
    onOpenChange,
}: {
    pledge: PeerifyPledgeRecord | null;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Dialog open={pledge !== null} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                {pledge ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>{pledge.pledgerName || "Unknown supporter"}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 text-sm">
                            <DetailRow label="Location" value={getCityAreaLabel(pledge.fanLocation)} />
                            <DetailRow label="Max ticket" value={pledge.maximumTicketAmount || "-"} />
                            <DetailRow label="Event type" value={pledge.preferredEventType || "-"} />
                            <div>
                                <div className="text-xs font-medium uppercase text-slate-500">Help offered</div>
                                {pledge.helpOptions.length > 0 ? (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {pledge.helpOptions.map((option) => (
                                            <Badge key={option} variant="outline">
                                                {option}
                                            </Badge>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="mt-1 text-slate-500">-</p>
                                )}
                                {pledge.hostingCapacity ? (
                                    <p className="mt-1 text-xs text-muted-foreground">Capacity: {pledge.hostingCapacity}</p>
                                ) : null}
                            </div>
                            <div>
                                <div className="text-xs font-medium uppercase text-slate-500">Note</div>
                                <p className="mt-1 whitespace-pre-wrap text-slate-700">{pledge.note || "-"}</p>
                            </div>
                            <DetailRow label="Pledged" value={formatDate(pledge.createdAt)} />
                        </div>
                        <DialogFooter>
                            <MessagePledgerButton pledge={pledge} compact={false} />
                        </DialogFooter>
                    </>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

function PledgeMapPreview({ clusters }: { clusters: PledgeLocationCluster[] }) {
    const topCluster = clusters[0];
    const maxPledgeCount = Math.max(...clusters.map((cluster) => cluster.pledgeCount), 1);

    return (
        <Card className="overflow-hidden rounded-lg border-slate-200 bg-white shadow-none">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <MapPinned className="h-5 w-5 text-[#231f1a]" />
                            <CardTitle className="text-lg">Pledge Map</CardTitle>
                        </div>
                        <p className="mt-2 max-w-2xl text-sm text-slate-600">
                            Locations are shown at city/area level. Individual pledge details are private to profile
                            managers.
                        </p>
                    </div>
                    {topCluster ? (
                        <Badge variant="secondary" className="w-fit rounded-full px-3 py-1">
                            Strongest demand: {topCluster.label}
                        </Badge>
                    ) : null}
                </div>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="relative min-h-72 overflow-hidden rounded-lg border border-slate-200 bg-[radial-gradient(circle_at_20%_20%,#e0f2fe_0,#e0f2fe_16%,transparent_17%),radial-gradient(circle_at_75%_30%,#fef3c7_0,#fef3c7_12%,transparent_13%),linear-gradient(135deg,#f8fafc,#eef2ff)] p-4">
                    <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(#cbd5e1_1px,transparent_1px),linear-gradient(90deg,#cbd5e1_1px,transparent_1px)] [background-size:36px_36px]" />
                    <div className="relative grid h-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {clusters.slice(0, 6).map((cluster, index) => {
                            const intensity = Math.max(44, Math.round((cluster.pledgeCount / maxPledgeCount) * 100));

                            return (
                                <a
                                    key={cluster.label}
                                    href={`#${getLocationClusterId(cluster.label)}`}
                                    className="group flex min-h-28 flex-col justify-between rounded-lg border border-white/80 bg-white/90 p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-[#231f1a]/30 hover:shadow-md"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-medium uppercase text-slate-500">
                                                Cluster {index + 1}
                                            </p>
                                            <h3 className="mt-1 text-base font-semibold text-[#231f1a]">
                                                {cluster.label}
                                            </h3>
                                        </div>
                                        <span
                                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#231f1a] text-sm font-semibold text-white ring-4 ring-white"
                                            style={{ opacity: intensity / 100 }}
                                        >
                                            {cluster.pledgeCount}
                                        </span>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                                        <span className="inline-flex items-center gap-1">
                                            <Users className="h-3.5 w-3.5" />
                                            {cluster.pledgeCount} pledges
                                        </span>
                                        <span className="inline-flex items-center gap-1">
                                            <HandHeart className="h-3.5 w-3.5" />
                                            {cluster.helpOfferCount} help offers
                                        </span>
                                    </div>
                                </a>
                            );
                        })}
                    </div>
                </div>

                <div className="space-y-3">
                    <div>
                        <h3 className="text-sm font-semibold text-[#231f1a]">Ranked demand clusters</h3>
                        <p className="mt-1 text-xs text-slate-500">Grouped from pledge location text.</p>
                    </div>
                    <div className="max-h-72 space-y-3 overflow-auto pr-1">
                        {clusters.map((cluster) => (
                            <div
                                key={cluster.label}
                                id={getLocationClusterId(cluster.label)}
                                className="rounded-lg border border-slate-200 bg-white p-3"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h4 className="font-medium text-[#231f1a]">{cluster.label}</h4>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {cluster.pledgeCount} pledge{cluster.pledgeCount === 1 ? "" : "s"} -{" "}
                                            {formatEstimatedTicketValue(cluster.estimatedTicketValue)} estimated ticket
                                            value
                                        </p>
                                    </div>
                                    <Badge variant="secondary">{cluster.helpOfferCount} help</Badge>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-1">
                                    {cluster.helpOptions.length > 0 ? (
                                        cluster.helpOptions.map((option) => (
                                            <Badge key={option.label} variant="outline">
                                                {option.label}
                                                {option.count > 1 ? ` x ${option.count}` : ""}
                                            </Badge>
                                        ))
                                    ) : (
                                        <span className="text-xs text-slate-500">No support offers yet</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
