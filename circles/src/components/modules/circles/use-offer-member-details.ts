"use client";

import { useEffect, useState } from "react";
import { getOfferDetailsForMemberAction } from "./map-explorer-actions";
import { OfferMemberDetails } from "@/models/models";

// Module-level cache + in-flight de-dupe, keyed by offerId (OfferMapPin._id), so hovering a pin
// (map.tsx's hover popup) and then clicking it open (CrewOfferMapPreview's full slider panel)
// never issues two network requests for the same offer. Never invalidated within a page
// session — offer details are edited rarely, and only by the circle's own admin, so a stale read
// for the rest of one map session is an acceptable tradeoff against re-fetching on every hover.
const detailsCache = new Map<string, Promise<OfferMemberDetails | null>>();

export function fetchOfferMemberDetails(offerId: string): Promise<OfferMemberDetails | null> {
    let pending = detailsCache.get(offerId);
    if (!pending) {
        pending = getOfferDetailsForMemberAction(offerId).catch((error) => {
            console.error("fetchOfferMemberDetails error:", error);
            return null;
        });
        detailsCache.set(offerId, pending);
    }
    return pending;
}

// undefined = still loading (or no offerId yet); null = fetched, nothing accessible (denied or
// not found) — callers should tell these apart so a slow load doesn't flash an empty/error state.
export function useOfferMemberDetails(offerId: string | undefined): OfferMemberDetails | null | undefined {
    const [details, setDetails] = useState<OfferMemberDetails | null | undefined>(undefined);

    useEffect(() => {
        if (!offerId) {
            setDetails(undefined);
            return;
        }
        let cancelled = false;
        setDetails(undefined);
        fetchOfferMemberDetails(offerId).then((result) => {
            if (!cancelled) {
                setDetails(result);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [offerId]);

    return details;
}
