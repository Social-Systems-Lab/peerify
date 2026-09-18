"use client";

import React, { useState, useTransition } from "react";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { Loader2 } from "lucide-react";
import UserPicker from "@/components/forms/user-picker";
import { MemberUserGroupsGrid } from "@/components/forms/dynamic-field";
import { getMyAcceptedConnectionsAction, inviteUserToAdminAction, searchMyAcceptedConnectionsAction } from "./actions";
import { Circle, MemberDisplay } from "@/models/models";

type Props = {
    circle: Circle;
};

export default function InviteAdminDialog({ circle }: Props) {
    const [user] = useAtom(userAtom);
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<Circle[]>([]);
    const [isPending, startTransition] = useTransition();
    const methods = useForm<{ memberUserGroups: Record<string, string[]> }>({
        defaultValues: { memberUserGroups: {} },
    });
    const memberUserGroups = useWatch({ control: methods.control, name: "memberUserGroups" });

    // Synthetic rows so MemberUserGroupsGrid - built for existing Members - can be reused to pick
    // roles for candidates who have no Member doc (and therefore no userGroups) yet.
    const candidateRows: MemberDisplay[] = selected.map(
        (candidate) =>
            ({
                userDid: candidate.did!,
                name: candidate.name,
                picture: candidate.picture,
                circleId: circle._id ?? "",
                userGroups: [],
            }) as unknown as MemberDisplay,
    );

    const resetAndClose = () => {
        setSelected([]);
        methods.reset({ memberUserGroups: {} });
        setOpen(false);
    };

    const onSubmit = () => {
        if (selected.length === 0) return;

        const missingRole = selected.find((candidate) => !(memberUserGroups?.[candidate.did!]?.length > 0));
        if (missingRole) {
            toast({
                icon: "error",
                title: "Pick a role",
                description: `Choose at least one role to offer ${missingRole.name}.`,
                variant: "destructive",
            });
            return;
        }

        startTransition(async () => {
            const results = await Promise.all(
                selected.map(async (candidate) => {
                    const offeredGroups: string[] = memberUserGroups?.[candidate.did!] || [];
                    const result = await inviteUserToAdminAction(circle, candidate.did!, offeredGroups);
                    return { candidate, result };
                }),
            );

            const succeeded = results.filter((r) => r.result.success);
            const failed = results.filter((r) => !r.result.success);

            if (succeeded.length > 0) {
                toast({
                    icon: "success",
                    title: "Invitation sent",
                    description:
                        succeeded.length === 1
                            ? `${succeeded[0].candidate.name}: ${succeeded[0].result.message}`
                            : `Sent to ${succeeded.length} people.`,
                });
            }
            for (const { candidate, result } of failed) {
                toast({
                    icon: "error",
                    title: `Couldn't invite ${candidate.name}`,
                    description: result.message,
                    variant: "destructive",
                });
            }

            if (failed.length === 0) {
                resetAndClose();
            }
        });
    };

    return (
        <>
            <Button variant="outline" onClick={() => setOpen(true)}>
                Invite Admin
            </Button>
            <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : resetAndClose())}>
                <DialogContent onInteractOutside={(e) => e.preventDefault()}>
                    <DialogHeader>
                        <DialogTitle>Invite an Admin</DialogTitle>
                        <DialogDescription>
                            Invite one of your connections to a role in {circle.name}. They&apos;ll need to accept
                            before they get access - this doesn&apos;t grant it right away.
                        </DialogDescription>
                    </DialogHeader>

                    <UserPicker
                        placeholder="Search your connections..."
                        onSelectionChange={setSelected}
                        fetchInitial={async () => (await getMyAcceptedConnectionsAction()).circles}
                        fetchSearch={async (query, limit) => (await searchMyAcceptedConnectionsAction(query, limit)).circles}
                    />

                    {selected.length > 0 && (
                        <FormProvider {...methods}>
                            <div className="mt-2">
                                <p className="mb-2 text-sm text-muted-foreground">Choose which role(s) to offer:</p>
                                <MemberUserGroupsGrid
                                    currentUser={user}
                                    members={candidateRows}
                                    control={methods.control}
                                    circle={circle}
                                />
                            </div>
                        </FormProvider>
                    )}

                    <DialogFooter className="pt-4">
                        <Button variant="outline" onClick={resetAndClose}>
                            Cancel
                        </Button>
                        <Button onClick={onSubmit} disabled={isPending || selected.length === 0}>
                            {isPending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Sending...
                                </>
                            ) : (
                                <>Send Invitation</>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
