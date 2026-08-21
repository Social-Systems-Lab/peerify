"use client";

import React, { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { Circle, MemberDisplay } from "@/models/models";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CirclePicture } from "@/components/modules/circles/circle-picture";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { getCrewProfileAccessAction, setCrewVisibilityAction } from "./actions";

interface CrewMembersTableProps {
    circle: Circle;
    members: MemberDisplay[];
}

// Modeled on isSuppressedPersonalProfile's flag check, but keyed on this membership's
// crewVisible rather than the account-wide mapVisible/searchable flags.
const isSuppressedCrewMember = (member: MemberDisplay): boolean => member.crewVisible === false;

const CrewMemberRow: React.FC<{ circle: Circle; member: MemberDisplay; viewerDid?: string }> = ({
    circle,
    member,
    viewerDid,
}) => {
    const { toast } = useToast();
    const ownerRestrictsVisibility = isSuppressedCrewMember(member);
    const isSelf = viewerDid === member.userDid;

    // Defaults to no access (safe/closed) until the check resolves, matching
    // isSuppressedPersonalProfile's bypass idiom — the real name/picture never flashes before
    // the server-side admin/moderator check comes back.
    const [hasAccess, setHasAccess] = useState(isSelf);
    useEffect(() => {
        if (!ownerRestrictsVisibility || isSelf) {
            return;
        }
        let isCurrent = true;
        getCrewProfileAccessAction(circle._id ?? "", member.userDid).then((result) => {
            if (isCurrent) setHasAccess(result.hasAccess);
        });
        return () => {
            isCurrent = false;
        };
    }, [ownerRestrictsVisibility, isSelf, circle._id, member.userDid]);

    const suppressed = ownerRestrictsVisibility && !hasAccess;

    const [crewVisible, setCrewVisibleState] = useState(member.crewVisible !== false);
    const [isSaving, setIsSaving] = useState(false);

    const onToggle = async (checked: boolean) => {
        setIsSaving(true);
        setCrewVisibleState(checked);
        const res = await setCrewVisibilityAction(circle._id ?? "", checked);
        setIsSaving(false);
        if (!res.success) {
            setCrewVisibleState(!checked);
            toast({ title: "Error", description: res.message, variant: "destructive" });
        }
    };

    return (
        <TableRow>
            <TableCell>
                <div className="flex items-center gap-2">
                    <CirclePicture
                        circle={suppressed ? { name: "Crew member" } : { name: member.name, picture: member.picture as any }}
                        size="32px"
                    />
                    <span>{suppressed ? "Crew member" : member.name}</span>
                    {suppressed && <Lock className="h-3 w-3 text-muted-foreground" />}
                </div>
            </TableCell>
            <TableCell>
                {isSelf && (
                    <div className="flex items-center gap-2">
                        <Switch
                            id={`crew-visible-${member.userDid}`}
                            checked={crewVisible}
                            onCheckedChange={onToggle}
                            disabled={isSaving}
                        />
                        <Label htmlFor={`crew-visible-${member.userDid}`} className="text-sm text-muted-foreground">
                            Visible to other Crew members
                        </Label>
                    </div>
                )}
            </TableCell>
        </TableRow>
    );
};

const CrewMembersTable: React.FC<CrewMembersTableProps> = ({ circle, members }) => {
    const [user] = useAtom(userAtom);

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Crew Member</TableHead>
                    <TableHead>Visibility</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {members.length === 0 && (
                    <TableRow>
                        <TableCell colSpan={2} className="text-center">
                            No Crew members yet
                        </TableCell>
                    </TableRow>
                )}
                {members.map((member) => (
                    <CrewMemberRow key={member.userDid} circle={circle} member={member} viewerDid={user?.did} />
                ))}
            </TableBody>
        </Table>
    );
};

export default CrewMembersTable;
