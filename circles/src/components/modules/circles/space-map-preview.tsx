"use client";

// The panel a pop-up or private space pin opens (SpaceMapPin, models.ts). Everyone sees the kind of
// space, its area, and a pop-up's name when its owner shows it. A signed-in viewer also gets the
// space's details (getSpaceDetailsForMemberAction) and a way to tell the Peerify team they're
// interested: there's no request flow yet, so the team passes requests on to hosts by hand.
// Nothing here names or links to the host.

import React, { useEffect, useState } from "react";
import { useAtom } from "jotai";
import Link from "next/link";
import { Home, Mail, MapPin, Store } from "lucide-react";
import { userAtom } from "@/lib/data/atoms";
import { Media, SpaceMapPin, SpaceMemberDetails } from "@/models/models";
import {
    SPACE_AMPLIFICATION_LABELS,
    SPACE_DEAL_PREFERENCE_LABELS,
    NOT_VETTED_TEXT,
    SPACE_TYPE_LABELS,
    spaceAreaLabel,
    spaceSettingLabel,
    spaceStepFreeAccessLabel,
} from "@/lib/spaces/space-labels";
import { Skeleton } from "@/components/ui/skeleton";
import ImageCarousel from "@/components/ui/image-carousel";
import { getSpaceDetailsForMemberAction } from "./map-explorer-actions";

export const PEERIFY_TEAM_EMAIL = "hello@peerify.net";

// The space's id goes in the email so the team can find it on /admin/spaces. It says nothing about
// the host to anyone who sees the email.
export const spaceInterestMailto = (spaceId: string): string =>
    `mailto:${PEERIFY_TEAM_EMAIL}?subject=${encodeURIComponent("Interested in a space")}&body=${encodeURIComponent(
        `Hi Peerify team,\n\nI'm interested in this space (reference ${spaceId}).\n\n`,
    )}`;

const yesNo = (value: boolean) => (value ? "Yes" : "No");

const detailRows = (details: SpaceMemberDetails): [string, string][] => {
    const rows: [string, string][] = [["People", String(details.capacity)]];
    if (details.spaceKind === "popup") {
        rows.push(["Shows", details.showTimes]);
        if (details.noiseLimits) rows.push(["Noise limits", details.noiseLimits]);
        rows.push(["Power sockets", yesNo(details.powerAvailable)]);
        rows.push(["PA or speakers", yesNo(details.paAvailable)]);
    } else {
        rows.push(["Setting", details.setting.map(spaceSettingLabel).join(", ")]);
        rows.push(["Sound", SPACE_AMPLIFICATION_LABELS[details.amplification]]);
        if (details.noiseCurfew) rows.push(["Noise curfew", details.noiseCurfew]);
        rows.push(["Step-free access", spaceStepFreeAccessLabel(details.stepFreeAccess)]);
    }
    rows.push(["The host would like", details.dealPreferences.map((d) => SPACE_DEAL_PREFERENCE_LABELS[d]).join(", ")]);
    return rows;
};

export default function SpaceMapPreview({ pin }: { pin: SpaceMapPin }) {
    const [user] = useAtom(userAtom);
    const isSignedIn = Boolean(user?.did);
    // undefined = loading, null = nothing to show (signed out, or the space left the map).
    const [details, setDetails] = useState<SpaceMemberDetails | null | undefined>(isSignedIn ? undefined : null);

    useEffect(() => {
        if (!isSignedIn) {
            setDetails(null);
            return;
        }
        let canceled = false;
        setDetails(undefined);
        getSpaceDetailsForMemberAction(pin._id).then((result) => {
            if (!canceled) setDetails(result);
        });
        return () => {
            canceled = true;
        };
    }, [pin._id, isSignedIn]);

    const area = spaceAreaLabel(pin.location);
    const KindIcon = pin.spaceKind === "popup" ? Store : Home;

    return (
        <div className="custom-scrollbar h-full overflow-y-auto p-4">
            <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-900">
                    <KindIcon className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                    <div className="truncate text-lg font-semibold">{pin.name ?? SPACE_TYPE_LABELS[pin.spaceKind]}</div>
                    {pin.name ? (
                        <div className="text-sm text-muted-foreground">{SPACE_TYPE_LABELS[pin.spaceKind]}</div>
                    ) : null}
                    {area ? (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{area}</span>
                        </div>
                    ) : null}
                </div>
            </div>

            <p className="mt-3 text-sm text-muted-foreground">
                {pin.atExactAddress
                    ? "The pin is at the space."
                    : "The pin is near the space, not at it. The address is shared only if the host agrees."}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{NOT_VETTED_TEXT}</p>

            {!isSignedIn ? (
                <p className="mt-4 text-sm">
                    <Link href="/login" className="font-medium text-primary hover:underline">
                        Log in
                    </Link>{" "}
                    to see more about this space.
                </p>
            ) : details === undefined ? (
                <div className="mt-4 space-y-2">
                    <Skeleton className="h-4 w-3/4 rounded" />
                    <Skeleton className="h-4 w-1/2 rounded" />
                </div>
            ) : details ? (
                <div className="mt-4 space-y-4">
                    {details.photos.length > 0 ? (
                        <div className="relative h-[220px] w-full overflow-hidden rounded-md">
                            <ImageCarousel
                                images={details.photos.map(
                                    (photo, index): Media => ({
                                        name: photo.originalName || `Space photo ${index + 1}`,
                                        type: "image",
                                        fileInfo: photo,
                                    }),
                                )}
                                options={{ loop: details.photos.length > 1 }}
                                containerClassName="h-full"
                                imageClassName="object-cover"
                                showArrows={false}
                                showDots={details.photos.length > 1}
                                dotsPosition="bottom-right"
                            />
                        </div>
                    ) : null}
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                        {detailRows(details).map(([label, value]) => (
                            <div key={label} className="contents">
                                <dt className="text-muted-foreground">{label}</dt>
                                <dd>{value}</dd>
                            </div>
                        ))}
                    </dl>
                    <a
                        href={spaceInterestMailto(pin._id)}
                        className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
                    >
                        <Mail className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                            Interested in this space?{" "}
                            <span className="font-medium text-primary underline">Message the Peerify team</span>
                            <span className="block text-muted-foreground">{PEERIFY_TEAM_EMAIL}</span>
                        </span>
                    </a>
                </div>
            ) : (
                <p className="mt-4 text-sm text-muted-foreground">This space isn&apos;t available any more.</p>
            )}
        </div>
    );
}
