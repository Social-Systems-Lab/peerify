import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAdminSpacesPage } from "@/lib/spaces/spaces-admin";
import type { AdminSpaceRow } from "@/lib/data/space";
import {
    SPACE_AMPLIFICATION_LABELS,
    SPACE_DEAL_PREFERENCE_LABELS,
    SPACE_TYPE_LABELS,
    spaceAreaLabel,
    spaceSettingLabel,
    spaceStepFreeAccessLabel,
} from "@/lib/spaces/space-labels";

// Every pop-up and private space, for platform admins only. A 404 for everyone else.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Spaces", robots: { index: false, follow: false } };

const date = (iso: string) => iso.slice(0, 16).replace("T", " ");

const details = (space: AdminSpaceRow): [string, string][] => {
    const point = space.location?.lngLat ? `${space.location.lngLat.lat}, ${space.location.lngLat.lng}` : "";
    const rows: [string, string][] = [];
    if (space.type === "popup") {
        rows.push(["Address", [space.location?.street, spaceAreaLabel(space.location)].filter(Boolean).join(", ")]);
        rows.push(["Map point", point]);
        rows.push(["Shows", space.showTimes]);
        if (space.noiseLimits) rows.push(["Noise limits", space.noiseLimits]);
        rows.push(["Power", space.powerAvailable ? "Yes" : "No"]);
        rows.push(["PA", space.paAvailable ? "Yes" : "No"]);
    } else {
        rows.push(["Area", spaceAreaLabel(space.location)]);
        rows.push([space.mapPinPlacedAt ? "Map pin (moved 200–400 m)" : "Rounded point (0.1°)", point]);
        rows.push(["Photos", String(space.photos?.length ?? 0)]);
        rows.push(["Setting", space.setting.map(spaceSettingLabel).join(", ")]);
        rows.push(["Sound", SPACE_AMPLIFICATION_LABELS[space.amplification]]);
        if (space.noiseCurfew) rows.push(["Noise curfew", space.noiseCurfew]);
        rows.push(["Step-free access", spaceStepFreeAccessLabel(space.stepFreeAccess)]);
    }
    rows.push(["People", String(space.capacity)]);
    rows.push(["In return", space.dealPreferences.map((d) => SPACE_DEAL_PREFERENCE_LABELS[d]).join(", ")]);
    if (space.type === "private" && space.notesForPeerify) rows.push(["Notes for Peerify", space.notesForPeerify]);
    rows.push(["Listening rule ticked", date(space.listeningRuleAcceptedAt)]);
    rows.push(["Host responsibility ticked", date(space.hostResponsibilityAcceptedAt)]);
    rows.push(["Updated", date(space.updatedAt)]);
    return rows;
};

export default async function AdminSpacesPage() {
    const data = await loadAdminSpacesPage();
    if (data.status === "not_found") {
        notFound();
    }

    const counts = {
        popup: data.spaces.filter((s) => s.type === "popup").length,
        private: data.spaces.filter((s) => s.type === "private").length,
    };

    return (
        <div className="container mx-auto max-w-4xl p-4">
            <h1 className="mb-1 text-2xl font-bold">Spaces</h1>
            <p className="mb-6 text-sm text-muted-foreground">
                Every pop-up and home or private space, newest first: {counts.popup} pop-up, {counts.private} private.
                Venues are venue circles and aren&apos;t listed here. Owner emails are for contacting hosts only: don&apos;t
                copy them out of this page.
            </p>

            {data.spaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">No spaces yet.</p>
            ) : (
                <ul className="space-y-4">
                    {data.spaces.map((space) => (
                        <li key={space._id} className="rounded-md border p-4 text-sm">
                            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                                <span className="font-mono text-xs text-muted-foreground">{date(space.createdAt)}</span>
                                <span className="font-semibold">
                                    {space.type === "popup" ? space.name : spaceAreaLabel(space.location) || "Area set"}
                                </span>
                                <span className="text-muted-foreground">{SPACE_TYPE_LABELS[space.type]}</span>
                                {space.type === "private" && space.mapPinPlacedAt ? (
                                    <span className="text-muted-foreground">On the map</span>
                                ) : null}
                                {/* The reference a "Message the Peerify team" email quotes. */}
                                <span className="font-mono text-xs text-muted-foreground">ref {space._id}</span>
                            </div>
                            <div className="mt-1">
                                {space.owner ? (
                                    <>
                                        {space.owner.name ?? "(no name)"}
                                        {space.owner.handle ? (
                                            <>
                                                {" · "}
                                                <Link href={`/circles/${space.owner.handle}`} className="text-blue-700 underline">
                                                    @{space.owner.handle}
                                                </Link>
                                            </>
                                        ) : null}
                                        {space.owner.email ? ` · ${space.owner.email}` : null}
                                    </>
                                ) : (
                                    <span className="text-muted-foreground">Owner account not found</span>
                                )}
                            </div>
                            <details className="mt-2">
                                <summary className="cursor-pointer text-xs text-muted-foreground">Details</summary>
                                <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                                    {details(space).map(([label, value]) => (
                                        <div key={label} className="contents">
                                            <dt className="text-muted-foreground">{label}</dt>
                                            <dd className="break-words">{value}</dd>
                                        </div>
                                    ))}
                                </dl>
                                {space.type === "private" && space.photos?.length ? (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {space.photos.map((photo) => (
                                            <a key={photo.url} href={photo.url} target="_blank" rel="noreferrer">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={photo.url} alt="" className="h-20 w-20 rounded object-cover" />
                                            </a>
                                        ))}
                                    </div>
                                ) : null}
                            </details>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
