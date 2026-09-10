"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, X } from "lucide-react";
import { TourTeamOffering } from "@/models/models";
import {
    getOfferDetailsSummary,
    getTourTeamOfferingIcon,
    getTourTeamOfferingLabel,
    accommodationSubTypeLabels,
    OFFER_MODAL_TYPES,
} from "@/lib/data/tour-team-offerings";
import { CreateOfferModal } from "./create-offer-modal";

interface OfferManagerProps {
    value: TourTeamOffering[] | undefined;
    onChange: (offerings: TourTeamOffering[]) => void;
    // Defaults to the full OFFER_MODAL_TYPES set (individual/"user" profiles) — venues pass
    // VENUE_OFFER_MODAL_TYPES to hide predefined types that don't fit a business profile. See
    // that constant's comment in tour-team-offerings.ts.
    allowedTypes?: readonly (typeof OFFER_MODAL_TYPES)[number][];
    // Offers save as one atomic write via the page's own "Save Changes" button, not per-offer —
    // this increments each time that save succeeds, and is the signal this component clears its
    // "touched since last save" id set on (see touchedIds below). NOT a version of the offerings
    // themselves — a plain counter is enough since all we need is "a save just happened."
    // Originally this tried to detect "unsaved" via object-reference comparison against a
    // last-saved snapshot, but react-hook-form deep-clones (cloneObject) form values on every
    // reset() and at init, so field.value's objects are never the same references as anything
    // held outside RHF's store — that broke the marker both on initial load and right after a
    // successful save. Tracking touched ids explicitly at the actual edit action, instead of
    // inferring "changed" from either object identity or a content diff, sidesteps both that
    // clone issue and the need to special-case in-flight photo File objects (not meaningfully
    // content-comparable) for a deep-equality check.
    saveVersion?: number;
}

export function OfferManager({ value, onChange, allowedTypes = OFFER_MODAL_TYPES, saveVersion }: OfferManagerProps) {
    const [modalOpen, setModalOpen] = useState(false);
    // Non-null while editing an existing offering — CreateOfferModal reads this to open straight
    // to a pre-filled Step 2 instead of the create flow's Step 1 grid. Cleared on close so the
    // next "Add an offer" click doesn't reopen into a stale edit.
    const [editingOffering, setEditingOffering] = useState<TourTeamOffering | null>(null);
    const offerings = useMemo(() => (Array.isArray(value) ? value : []), [value]);

    const existingTypes = useMemo(
        () => new Set(offerings.filter((o) => o.type !== "custom").map((o) => o.type)),
        [offerings],
    );

    // Ids of offerings added/edited via the modal since the last successful page-level save —
    // set explicitly at the two points a real edit happens (addOffering/saveOffering), not
    // inferred from a diff, so it directly records the user action rather than something that
    // could be fooled by object identity or content-shape changes.
    const [touchedIds, setTouchedIds] = useState<Set<string>>(new Set());

    // This effect fires on mount too (every useEffect does, regardless of its deps array), but
    // there's nothing to clear yet — touchedIds already starts empty — so skip that first run
    // rather than do a no-op set-state. Ref-based (not e.g. comparing saveVersion to its initial
    // value), since a caller's initial saveVersion isn't necessarily 0/undefined.
    const isFirstRender = React.useRef(true);
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        setTouchedIds(new Set());
    }, [saveVersion]);

    const removeOffering = (id: string) => {
        onChange(offerings.filter((offering) => offering.id !== id));
        setTouchedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    const addOffering = (offering: TourTeamOffering) => {
        onChange([...offerings, offering]);
        setTouchedIds((prev) => new Set(prev).add(offering.id));
    };

    const saveOffering = (updated: TourTeamOffering) => {
        onChange(offerings.map((offering) => (offering.id === updated.id ? updated : offering)));
        setTouchedIds((prev) => new Set(prev).add(updated.id));
    };

    const openAddModal = () => {
        setEditingOffering(null);
        setModalOpen(true);
    };

    const openEditModal = (offering: TourTeamOffering) => {
        setEditingOffering(offering);
        setModalOpen(true);
    };

    const handleModalOpenChange = (open: boolean) => {
        setModalOpen(open);
        if (!open) setEditingOffering(null);
    };

    return (
        <div className="space-y-3">
            {offerings.length > 0 && (
                <div className="space-y-2">
                    {offerings.map((offering) => {
                        const Icon = getTourTeamOfferingIcon(offering);
                        const summary = getOfferDetailsSummary(offering);
                        const thumbnail = offering.photos?.[0]?.url;
                        const isUnsaved = touchedIds.has(offering.id);
                        return (
                            <div key={offering.id} className="flex items-start gap-3 rounded-md border px-3 py-2">
                                {thumbnail ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={thumbnail} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                                ) : (
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted">
                                        <Icon className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1 space-y-0.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-medium">{getTourTeamOfferingLabel(offering)}</p>
                                        {isUnsaved && (
                                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-medium">
                                                Unsaved
                                            </Badge>
                                        )}
                                    </div>
                                    {offering.accommodationType && (
                                        <p className="text-xs text-muted-foreground">
                                            {accommodationSubTypeLabels[offering.accommodationType]}
                                        </p>
                                    )}
                                    {/* Bare-bones fallback for legacy offerings with no structured `details`
                                        (all current data is demo data): summary is undefined so only `detail`
                                        (if present) renders. For everything created via the modal now, `detail`
                                        is its own general freeform note independent of `details`, so both can
                                        render together. */}
                                    {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
                                    {offering.detail && <p className="text-xs text-muted-foreground">{offering.detail}</p>}
                                </div>
                                <button
                                    type="button"
                                    aria-label="Edit offering"
                                    onClick={() => openEditModal(offering)}
                                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/10"
                                >
                                    <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    aria-label="Remove offering"
                                    onClick={() => removeOffering(offering.id)}
                                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/10"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            <Button type="button" variant="outline" onClick={openAddModal}>
                Add an offer
            </Button>

            <CreateOfferModal
                open={modalOpen}
                onOpenChange={handleModalOpenChange}
                allowedTypes={allowedTypes}
                existingTypes={existingTypes}
                onAdd={addOffering}
                onSave={saveOffering}
                editingOffering={editingOffering}
            />
        </div>
    );
}
