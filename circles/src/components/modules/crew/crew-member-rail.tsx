// crew-member-rail.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { Circle, MemberDisplay } from "@/models/models";
import { UserPicture } from "@/components/modules/members/user-picture";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { getCrewProfileAccessAction, setCrewVisibilityAction } from "./actions";

type CrewMemberRailProps = {
    circle: Circle;
    members: MemberDisplay[];
};

// Modeled on isSuppressedPersonalProfile's flag check, but keyed on this membership's
// crewVisible rather than the account-wide mapVisible/searchable flags.
const isSuppressedCrewMember = (member: MemberDisplay): boolean => member.crewVisible === false;

const CrewRailAvatar: React.FC<{ circle: Circle; member: MemberDisplay; viewerDid?: string }> = ({
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

    // UserPicture's own fallback (no name/picture) renders the generic default silhouette
    // image, not blank/empty initials — that's the "generic silhouette" a hidden member should
    // show, same idiom (default asset + lock badge) content-preview.tsx uses for a suppressed
    // personal profile.
    const avatar = (
        <div className="relative shrink-0 rounded-full border-2 border-white bg-white shadow-sm">
            <UserPicture name={suppressed ? undefined : member.name} picture={suppressed ? undefined : member.picture?.url} size="40px" />
            {suppressed && (
                <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-white bg-muted-foreground">
                    <Lock className="h-2.5 w-2.5 text-white" />
                </div>
            )}
        </div>
    );

    // Your own avatar is where the visibility toggle lives (see crew.tsx's memory notes on why
    // this wasn't given a dedicated settings page: no existing per-membership settings surface,
    // and a fan can be Crew for several artists with independent preferences each — a popover on
    // your own avatar keeps this self-contained without inventing new navigation for one toggle).
    if (isSelf) {
        return (
            <Popover>
                <PopoverTrigger asChild>
                    <button type="button" aria-label="Your Crew visibility settings">
                        {avatar}
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-64">
                    <div className="flex items-center justify-between gap-3">
                        <Label htmlFor={`crew-visible-${member.userDid}`} className="text-sm">
                            Visible to other Crew members
                        </Label>
                        <Switch
                            id={`crew-visible-${member.userDid}`}
                            checked={crewVisible}
                            onCheckedChange={onToggle}
                            disabled={isSaving}
                        />
                    </div>
                </PopoverContent>
            </Popover>
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span>{avatar}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
                {suppressed ? "Crew member" : member.name}
            </TooltipContent>
        </Tooltip>
    );
};

const CrewMemberRail: React.FC<CrewMemberRailProps> = ({ circle, members }) => {
    const [user] = useAtom(userAtom);

    if (members.length === 0) {
        return <p className="text-sm text-muted-foreground">No Crew members yet.</p>;
    }

    return (
        <TooltipProvider>
            <div className="flex flex-wrap items-center gap-2">
                {members.map((member) => (
                    <CrewRailAvatar key={member.userDid} circle={circle} member={member} viewerDid={user?.did} />
                ))}
            </div>
        </TooltipProvider>
    );
};

export default CrewMemberRail;
