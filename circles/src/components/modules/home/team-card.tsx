"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { UserPicture } from "../members/user-picture";
import {
    TEAM_NOTE_EDITOR_HINT,
    TEAM_NOTE_MAX_LENGTH,
    type TeamCardData,
    type TeamCardRole,
} from "@/lib/peerify/team-card";
import { removeTeamNoteAction, saveTeamNoteAction, setTeamCardVisibilityAction } from "./team-card-actions";

type TeamCardProps = {
    circleId: string;
    data: TeamCardData;
    // The viewer's role in this circle (null for everyone else) and whether they're on the card.
    viewerRole: TeamCardRole | null;
    viewerOnCard: boolean;
    isCompact?: boolean;
};

// Whether the card renders at all: something public on it, or a viewer who manages it.
export const shouldShowTeamCard = (data: TeamCardData | null | undefined, viewerRole: TeamCardRole | null): boolean =>
    !!viewerRole || !!data?.note || (data?.members.length ?? 0) > 0;

const formatNoteDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export default function TeamCard({ circleId, data, viewerRole, viewerOnCard, isCompact }: TeamCardProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(data.note?.text ?? "");
    const isAdmin = viewerRole === "Admin";

    if (!shouldShowTeamCard(data, viewerRole)) return null;

    const run = (action: () => Promise<{ success: boolean; message?: string }>, after?: () => void) =>
        startTransition(async () => {
            const result = await action();
            if (!result.success) {
                toast({ icon: "error", title: "Couldn't save", description: result.message, variant: "destructive" });
                return;
            }
            after?.();
            router.refresh();
        });

    return (
        <div
            className={`flex flex-col bg-white p-6 ${
                isCompact ? "rounded-none" : "rounded-[15px] border-0 bg-muted/20 shadow-lg"
            }`}
            data-testid="team-card"
        >
            <div className="mb-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Team</div>

            {data.note && !editing && (
                <div className="mb-4 rounded-lg bg-muted/40 p-3">
                    <p className="whitespace-pre-line break-words text-[15px] text-foreground">{data.note.text}</p>
                    <div className="mt-2 text-xs text-muted-foreground">
                        {data.note.authorHandle ? (
                            <Link href={`/circles/${data.note.authorHandle}`} className="hover:underline">
                                {data.note.authorName}
                            </Link>
                        ) : (
                            data.note.authorName
                        )}
                        {" · "}
                        {formatNoteDate(data.note.updatedAt)}
                    </div>
                    {isAdmin && (
                        <div className="mt-2 flex gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={isPending}
                                onClick={() => {
                                    setDraft(data.note?.text ?? "");
                                    setEditing(true);
                                }}
                            >
                                Edit note
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={isPending}
                                onClick={() => run(() => removeTeamNoteAction(circleId))}
                            >
                                Remove
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {isAdmin && (editing || !data.note) && (
                <div className="mb-4 flex flex-col gap-2">
                    <Label htmlFor="team-note" className="text-sm">
                        {data.note ? "Edit the team note" : "Add a team note"}
                    </Label>
                    <Textarea
                        id="team-note"
                        value={draft}
                        maxLength={TEAM_NOTE_MAX_LENGTH}
                        onChange={(event) => setDraft(event.target.value)}
                        rows={3}
                    />
                    <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
                        <span>{TEAM_NOTE_EDITOR_HINT}</span>
                        <span className="shrink-0">
                            {draft.length}/{TEAM_NOTE_MAX_LENGTH}
                        </span>
                    </div>
                    {data.note && <div className="text-xs text-muted-foreground">A new note replaces the old one.</div>}
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            disabled={isPending || !draft.trim()}
                            onClick={() => run(() => saveTeamNoteAction(circleId, draft), () => setEditing(false))}
                        >
                            Post note
                        </Button>
                        {editing && (
                            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setEditing(false)}>
                                Cancel
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {data.members.length > 0 && (
                <ul className="space-y-3">
                    {data.members.map((member) => (
                        <li key={member.handle}>
                            <Link
                                href={`/circles/${member.handle}`}
                                className="flex items-center gap-3 rounded-lg hover:opacity-80"
                            >
                                <div className="shrink-0 rounded-full border-2 border-white bg-white">
                                    <UserPicture name={member.name} picture={member.pictureUrl} size="34px" />
                                </div>
                                <div className="min-w-0">
                                    <div className="truncate text-[15px] font-medium text-foreground">{member.name}</div>
                                    <div className="truncate text-xs text-muted-foreground">
                                        @{member.handle} · {member.role}
                                    </div>
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {viewerRole && (
                <div className="mt-4 flex flex-col gap-1 border-t border-border/60 pt-4">
                    <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="team-card-visible" className="text-sm">
                            Show me on the Team card
                        </Label>
                        <Switch
                            id="team-card-visible"
                            checked={viewerOnCard}
                            disabled={isPending}
                            onCheckedChange={(checked) => run(() => setTeamCardVisibilityAction(circleId, checked))}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Shows your name, picture, handle and role to everyone, also logged out.
                        {!data.note && data.members.length === 0
                            ? " Until someone joins or a note is posted, only admins and moderators see this card."
                            : ""}
                    </p>
                </div>
            )}
        </div>
    );
}
