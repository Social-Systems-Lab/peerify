"use client";

// Create → Add a space: the choice between the three kinds of space /hosts describes. A venue goes
// to the existing venue identity flow (a public venue circle); a pop-up or private space is a row
// in the spaces collection (see lib/data/space.ts).

import React from "react";
import { ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardTitle } from "@/components/ui/card";
import { SPACE_KIND_DESCRIPTIONS } from "@/lib/spaces/space-labels";
import { SPACE_KIND_ICONS, type SpaceKind } from "@/lib/spaces/space-kind-icons";

export type { SpaceKind };

const KINDS: { kind: SpaceKind; title: string; icon: React.ElementType }[] = [
    { kind: "venue", title: "Venue", icon: SPACE_KIND_ICONS.venue },
    { kind: "popup", title: "Pop-up space", icon: SPACE_KIND_ICONS.popup },
    { kind: "private", title: "Home or private space", icon: SPACE_KIND_ICONS.private },
];

interface AddSpaceDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onChoose: (kind: SpaceKind) => void;
}

export function AddSpaceDialog({ isOpen, onOpenChange, onChoose }: AddSpaceDialogProps) {
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[15px] bg-white p-0 sm:max-w-[600px]">
                <DialogHeader className="p-6 pb-4 text-center md:text-left">
                    <DialogTitle className="text-2xl font-bold">Add a space</DialogTitle>
                    <DialogDescription className="text-base text-muted-foreground">
                        What kind of space is it?
                    </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-4 p-6 pt-2">
                    {KINDS.map(({ kind, title, icon: Icon }) => (
                        <Card
                            key={kind}
                            role="button"
                            tabIndex={0}
                            onClick={() => onChoose(kind)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    onChoose(kind);
                                }
                            }}
                            className="group flex cursor-pointer flex-row items-center gap-4 rounded-2xl border border-[#e8dfd3] bg-[#fcfbf8] p-4 shadow-sm transition-all duration-200 hover:border-[#d9cbb6] hover:bg-white hover:shadow-md"
                        >
                            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-[#e3d8ca] bg-[#f5efe6] text-[#7b6750]">
                                <Icon className="h-6 w-6" />
                            </div>
                            <div className="flex-grow">
                                <CardTitle className="text-lg font-semibold text-[#3b352f]">{title}</CardTitle>
                                <p className="text-sm text-[#746b60]">{SPACE_KIND_DESCRIPTIONS[kind]}</p>
                            </div>
                            <ChevronRight className="h-5 w-5 text-[#9d8f80] transition-transform group-hover:translate-x-1" />
                        </Card>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default AddSpaceDialog;
