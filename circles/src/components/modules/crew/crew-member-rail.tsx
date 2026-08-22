// crew-member-rail.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { Circle, MemberDisplay } from "@/models/models";
import { UserPicture } from "@/components/modules/members/user-picture";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Lock, LogOut } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
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
import { getCrewProfileAccessAction, setCrewVisibilityAction, leaveCrewAction } from "./actions";

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
    const router = useRouter();
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

    const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
    const [isLeaving, setIsLeaving] = useState(false);

    // router.refresh() re-runs crew.tsx's server-side isEligible check with the now-updated
    // membership, which is what actually swaps the whole page over to CrewLanding — removing
    // this member from local state wouldn't be enough on its own, since the feed/Offers widget
    // live one level up in a sibling tree this component doesn't control.
    const onLeaveCrew = async () => {
        setIsLeaving(true);
        const res = await leaveCrewAction(circle._id ?? "");
        setIsLeaving(false);
        if (res.success) {
            setIsLeaveDialogOpen(false);
            router.refresh();
        } else {
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
                    <Separator className="my-3" />
                    <AlertDialog open={isLeaveDialogOpen} onOpenChange={setIsLeaveDialogOpen}>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto w-full justify-start gap-2 p-0 text-sm font-normal text-destructive hover:bg-transparent hover:text-destructive"
                            onClick={() => setIsLeaveDialogOpen(true)}
                        >
                            <LogOut className="h-3.5 w-3.5" />
                            Leave Crew
                        </Button>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Leave {circle.name}&apos;s Crew?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    You&apos;ll lose access to the Crew feed and Offers, and other Crew members won&apos;t
                                    see you in the list anymore. You&apos;ll still follow {circle.name} as normal, and
                                    can apply to rejoin Crew at any time.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel disabled={isLeaving}>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    disabled={isLeaving}
                                    onClick={onLeaveCrew}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    {isLeaving ? "Leaving…" : "Leave Crew"}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
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

// Capped on both mobile and desktop, not just mobile — even at desktop's md:col-span-1 sidebar
// width, a large Crew doesn't need every avatar rendered up front; a compact rail with a "+N"
// reveal reads as ambient context rather than a competing section, matching the layout brief.
// A simple expand-in-place (local state, no modal/sheet) was chosen over Radix's Collapsible:
// there's no height-animation concern here worth its measurement machinery for a flex-wrap row
// of small circular avatars — a plain conditional slice is simpler and more predictable.
const VISIBLE_CAP = 5;

const CrewMemberRail: React.FC<CrewMemberRailProps> = ({ circle, members }) => {
    const [user] = useAtom(userAtom);
    const [showAll, setShowAll] = useState(false);

    if (members.length === 0) {
        return <p className="text-sm text-muted-foreground">No Crew members yet.</p>;
    }

    // Your own avatar (where the visibility toggle lives) should always be reachable without
    // needing to expand the rail first.
    const ordered = [...members].sort((a, b) => (a.userDid === user?.did ? -1 : b.userDid === user?.did ? 1 : 0));
    const visibleMembers = showAll ? ordered : ordered.slice(0, VISIBLE_CAP);
    const hiddenCount = ordered.length - visibleMembers.length;

    return (
        <TooltipProvider>
            <div className="flex flex-wrap items-center gap-2">
                {visibleMembers.map((member) => (
                    <CrewRailAvatar key={member.userDid} circle={circle} member={member} viewerDid={user?.did} />
                ))}
                {hiddenCount > 0 && (
                    <button
                        type="button"
                        onClick={() => setShowAll(true)}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-white bg-muted text-xs font-medium text-muted-foreground shadow-sm hover:bg-muted/80"
                    >
                        +{hiddenCount}
                    </button>
                )}
                {showAll && ordered.length > VISIBLE_CAP && (
                    <button
                        type="button"
                        onClick={() => setShowAll(false)}
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                        Show less
                    </button>
                )}
            </div>
        </TooltipProvider>
    );
};

export default CrewMemberRail;
