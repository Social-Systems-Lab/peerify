"use client";

// The owner's own spaces on their profile's Settings → Spaces page: list, add, edit, delete.

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { SpaceFormDialog } from "@/components/spaces/space-form-dialog";
import type { SpaceView } from "@/lib/data/space";
import type { SpaceType } from "@/models/models";
import {
    SPACE_AMPLIFICATION_LABELS,
    SPACE_DEAL_PREFERENCE_LABELS,
    SPACE_TYPE_LABELS,
    spaceAreaLabel,
    spaceSettingLabel,
    spaceStepFreeAccessLabel,
} from "@/lib/spaces/space-labels";
import { SPACES_PER_PERSON_MAX as MAX_SPACES } from "@/lib/spaces/space-rules";
import { deleteSpaceAction } from "@/app/circles/[handle]/settings/spaces/actions";

const spaceTitle = (space: SpaceView) =>
    space.type === "popup" ? space.name : `${SPACE_TYPE_LABELS.private} · ${spaceAreaLabel(space.location) || "area set"}`;

function SpaceDetails({ space }: { space: SpaceView }) {
    const rows: [string, string][] = [];
    if (space.type === "popup") {
        rows.push(["Where", [space.location?.street, spaceAreaLabel(space.location)].filter(Boolean).join(", ")]);
    }
    rows.push(["People", String(space.capacity)]);
    if (space.type === "popup") {
        rows.push(["Shows", space.showTimes]);
        if (space.noiseLimits) rows.push(["Noise limits", space.noiseLimits]);
        rows.push([
            "Equipment",
            [space.powerAvailable ? "Power" : null, space.paAvailable ? "PA" : null].filter(Boolean).join(", ") || "None",
        ]);
    } else {
        rows.push(["Setting", space.setting.map(spaceSettingLabel).join(", ")]);
        rows.push(["Sound", SPACE_AMPLIFICATION_LABELS[space.amplification]]);
        if (space.noiseCurfew) rows.push(["Noise curfew", space.noiseCurfew]);
        rows.push(["Step-free access", spaceStepFreeAccessLabel(space.stepFreeAccess)]);
    }
    rows.push(["In return", space.dealPreferences.map((d) => SPACE_DEAL_PREFERENCE_LABELS[d]).join(", ")]);
    if (space.type === "private" && space.notesForPeerify) rows.push(["Notes for Peerify", space.notesForPeerify]);

    return (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {rows.map(([label, value]) => (
                <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-words">{value}</dd>
                </div>
            ))}
        </dl>
    );
}

export function SpacesSettings({ initialSpaces }: { initialSpaces: SpaceView[] }) {
    const { toast } = useToast();
    const [spaces, setSpaces] = useState(initialSpaces);
    const [adding, setAdding] = useState<SpaceType | null>(null);
    const [editing, setEditing] = useState<SpaceView | null>(null);
    const [deleting, setDeleting] = useState<SpaceView | null>(null);
    const [isPending, startTransition] = useTransition();
    const atLimit = spaces.length >= MAX_SPACES;

    const confirmDelete = () => {
        const target = deleting;
        if (!target) return;
        startTransition(async () => {
            const result = await deleteSpaceAction(target._id);
            setDeleting(null);
            if (!result.success) {
                toast({ title: "Could not delete the space", description: result.message, variant: "destructive" });
                return;
            }
            setSpaces(result.spaces);
            toast({ title: "Space deleted" });
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={() => setAdding("popup")} disabled={atLimit}>
                    Add a pop-up space
                </Button>
                <Button type="button" variant="outline" onClick={() => setAdding("private")} disabled={atLimit}>
                    Add a home or private space
                </Button>
                <span className="text-sm text-muted-foreground">
                    {atLimit
                        ? `You have ${MAX_SPACES} spaces, the most you can add. Delete one to add another.`
                        : `${spaces.length} of ${MAX_SPACES}`}
                </span>
            </div>

            {spaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    You haven&apos;t added a space yet. A venue gets its own public venue profile instead.
                </p>
            ) : (
                <div className="space-y-4">
                    {spaces.map((space) => (
                        <Card key={space._id}>
                            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-3">
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                        {SPACE_TYPE_LABELS[space.type]}
                                    </p>
                                    <CardTitle className="text-lg">{spaceTitle(space)}</CardTitle>
                                </div>
                                <div className="flex gap-1">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Edit space"
                                        onClick={() => setEditing(space)}
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Delete space"
                                        onClick={() => setDeleting(space)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <SpaceDetails space={space} />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {adding ? (
                <SpaceFormDialog
                    key={`add-${adding}`}
                    type={adding}
                    isOpen={true}
                    onOpenChange={(open) => !open && setAdding(null)}
                    onSaved={setSpaces}
                />
            ) : null}
            {editing ? (
                <SpaceFormDialog
                    key={editing._id}
                    type={editing.type}
                    space={editing}
                    isOpen={true}
                    onOpenChange={(open) => !open && setEditing(null)}
                    onSaved={setSpaces}
                />
            ) : null}

            <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this space?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleting ? spaceTitle(deleting) : ""} will be removed for good. This can&apos;t be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} disabled={isPending}>
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export default SpacesSettings;
