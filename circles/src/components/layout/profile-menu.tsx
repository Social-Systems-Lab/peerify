// profile-menu.tsx
"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "../ui/button";
import {
    userAtom,
    userToolboxDataAtom,
    sidePanelContentVisibleAtom,
    authInfoAtom,
    notificationUnreadCountAtom,
    mobileExploreAvatarSlotAtom,
} from "@/lib/data/atoms";
import { useAtom } from "jotai";
import { UserPicture } from "../modules/members/user-picture";
import { Bell, Check, ChevronDown, ChevronRight, UserRound } from "lucide-react";
import { Circle, UserToolboxTab } from "@/models/models";
import { LOG_LEVEL_TRACE, logLevel } from "@/lib/data/constants";
import { LuClipboardCheck, LuMail } from "react-icons/lu";
import { listChatRoomsAction } from "../modules/chat/actions";
import { getCircleDefaultPath } from "@/lib/utils/circle-routes";
import { useIsMobile } from "@/components/utils/use-is-mobile";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
    getPeerifyIdentityAvatarUrl,
    PEERIFY_DEFAULT_PROFILE_AVATAR_URL,
    isPeerifyManagedIdentity,
} from "@/lib/peerify/artist-profile";
import {
    getManagedIdentities,
    getCircleHandleFromPath,
    useActingIdentity,
    useSetActingIdentity,
} from "@/lib/utils/acting-identity";
import { ACTING_IDENTITY_STORAGE_KEY } from "@/lib/data/atoms";
import { isPilotChromePath } from "@/lib/peerify/pilot-chrome";
import { cn } from "@/lib/utils";

// Shared by the mail/clipboard/bell icon buttons (and, on the mobile Explore
// fan-out avatar, the combined-count badge) — was previously two near-identical
// inline absolutely-positioned spans.
const UnreadCountBadge: React.FC<{ count: number }> = ({ count }) => {
    if (count <= 0) return null;
    return (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white">
            {count}
        </span>
    );
};

// The identity-switcher's list body — shared by the desktop avatar popover and the
// mobile Explore fan-out's profile-switcher slot, so there's one place listing
// "Personal profile" / managed identities / "Go to profiles", not two copies.
const IdentitySwitcherPopoverContent: React.FC<{
    user: Circle;
    managedIdentities: Circle[];
    openProfile: (target: Circle) => void;
    renderCurrentOrActAs: (target: Circle, actAsTarget: Circle | undefined) => React.ReactNode;
    onGoToProfiles: () => void;
}> = ({ user, managedIdentities, openProfile, renderCurrentOrActAs, onGoToProfiles }) => (
    <div className="flex flex-col">
        <div className="flex w-full items-center gap-2 rounded-md p-2 hover:bg-muted">
            <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => openProfile(user)}
            >
                <UserPicture
                    name={user.name}
                    picture={user.picture?.url ?? PEERIFY_DEFAULT_PROFILE_AVATAR_URL}
                    size="36px"
                    circleType="user"
                />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{user.name}</div>
                    <div className="truncate text-xs text-muted-foreground">Personal profile</div>
                </div>
            </button>
            {renderCurrentOrActAs(user, undefined)}
        </div>

        {managedIdentities.length > 0 && (
            <div className="mt-1 border-t pt-1">
                {managedIdentities.map((identity) => (
                    <div key={identity._id} className="flex w-full items-center gap-2 rounded-md p-2 hover:bg-muted">
                        <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            onClick={() => openProfile(identity)}
                        >
                            <UserPicture
                                name={identity.name}
                                picture={getPeerifyIdentityAvatarUrl(identity)}
                                size="36px"
                                circleType="circle"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">{identity.name}</div>
                                <div className="truncate text-xs text-muted-foreground">Public profile</div>
                            </div>
                        </button>
                        {renderCurrentOrActAs(identity, identity)}
                    </div>
                ))}
            </div>
        )}

        <Button
            type="button"
            variant="ghost"
            className="mt-1 justify-between border-t pt-3 text-sm"
            onClick={onGoToProfiles}
        >
            Go to profiles
            <ChevronRight className="h-4 w-4" />
        </Button>
    </div>
);

const ProfileMenuBar = () => {
    const router = useRouter();
    const [authInfo] = useAtom(authInfoAtom);
    const [user] = useAtom(userAtom);
    const searchParams = useSearchParams();
    const [userToolboxState, setUserToolboxState] = useAtom(userToolboxDataAtom);
    const [sidePanelContentVisible] = useAtom(sidePanelContentVisibleAtom);
    const [notificationUnreadCount, setNotificationUnreadCount] = useAtom(notificationUnreadCountAtom);
    const [messageUnreadCount, setMessageUnreadCount] = useState(0);
    const [mobileExploreAvatarSlot] = useAtom(mobileExploreAvatarSlotAtom);
    const pathname = usePathname();
    const isMobile = useIsMobile();
    const currentVisibleIdentity = useActingIdentity();
    const setActingIdentity = useSetActingIdentity();

    // Mobile Explore only: tapping the avatar fans the mail/clipboard/bell icons out
    // to its left instead of opening the identity-switcher popover (see isMobileExplore
    // below — those icons are hidden by default only on this page).
    const [mobileIconsExpanded, setMobileIconsExpanded] = useState(false);
    const mobileFanRef = useRef<HTMLDivElement>(null);

    // Tracks the profile-switcher slot's own Popover open state, lifted out of Radix's
    // uncontrolled default so it can be paired with mobileIconsExpanded (see below).
    const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false);

    // While the profile-switcher popover is open, it renders its content through a Radix
    // Portal — outside mobileFanRef's DOM subtree — so the plain "outside pointerdown"
    // check below can't tell a tap inside the popover from a tap outside the whole fan;
    // it would collapse mobileIconsExpanded (unmounting the still-open Popover along with
    // it) before the tap's own click handler ("Act as", "Go to profiles", ...) ever runs.
    // Radix's own dismiss logic already knows the difference, so defer to it entirely
    // while the popover is open (see the Popover's onOpenChange below) instead of racing
    // it with this listener.
    useEffect(() => {
        if (!mobileIconsExpanded || profileSwitcherOpen) return;
        const onOutsidePointerDown = (event: PointerEvent) => {
            if (mobileFanRef.current && !mobileFanRef.current.contains(event.target as Node)) {
                setMobileIconsExpanded(false);
            }
        };
        document.addEventListener("pointerdown", onOutsidePointerDown);
        return () => document.removeEventListener("pointerdown", onOutsidePointerDown);
    }, [mobileIconsExpanded, profileSwitcherOpen]);

    useEffect(() => {
        if (!(isMobile && pathname === "/explore")) {
            setMobileIconsExpanded(false);
            setProfileSwitcherOpen(false);
        }
    }, [isMobile, pathname]);

    // Fixes hydration errors
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
        setIsMounted(true);
    }, []);

    // One-time seed: if this browser has never had an acting-identity choice persisted
    // (the storage key is entirely absent — distinct from an explicit prior choice of
    // "personal", which persists as an explicit null), default to whichever managed
    // identity's page the account happens to land on first. After that, acting identity
    // is only ever changed via the switcher's "Act as" control below — never by
    // navigation — which is exactly what fixes switching-resets-on-navigate.
    useEffect(() => {
        if (typeof window === "undefined" || !user) return;
        if (window.localStorage.getItem(ACTING_IDENTITY_STORAGE_KEY) !== null) return;
        const handle = getCircleHandleFromPath(pathname);
        if (!handle) return;
        const match = getManagedIdentities(user).find((identity) => identity.handle === handle);
        if (match) setActingIdentity(match);
    }, [user, pathname, setActingIdentity]);

    useEffect(() => {
        if (!user?.did) {
            setNotificationUnreadCount(0);
            setMessageUnreadCount(0);
            return;
        }

        let cancelled = false;
        const loadMessageUnreadCount = async () => {
            try {
                const result = await listChatRoomsAction();
                if (!cancelled) {
                    const unreadTotal =
                        result.success && result.rooms
                            ? result.rooms.reduce((total, room) => total + (room.unreadCount || 0), 0)
                            : 0;
                    setMessageUnreadCount(unreadTotal);
                }
            } catch (error) {
                if (!cancelled) {
                    console.error("Failed to fetch message unread count:", error);
                }
            }
        };

        const loadNotificationUnreadCount = async () => {
            try {
                const response = await fetch("/api/notifications/unread-count", { cache: "no-store" });
                if (!response.ok) {
                    throw new Error(`Failed to load notification unread count (${response.status})`);
                }

                const data = await response.json();
                if (!cancelled) {
                    setNotificationUnreadCount(typeof data.unreadCount === "number" ? data.unreadCount : 0);
                }
            } catch (error) {
                if (!cancelled) {
                    console.error("Failed to fetch notification unread count:", error);
                }
            }
        };

        void loadMessageUnreadCount();
        void loadNotificationUnreadCount();
        const intervalId = window.setInterval(() => {
            void loadMessageUnreadCount();
            void loadNotificationUnreadCount();
        }, 15000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [setNotificationUnreadCount, user?.did]);

    const openUserToolbox = (tab: UserToolboxTab) => {
        if (
            sidePanelContentVisible === "toolbox" &&
            (userToolboxState?.tab === tab || (tab === "profile" && userToolboxState))
        ) {
            setUserToolboxState(undefined);
            return;
        }
        setUserToolboxState({ tab: tab });
    };

    const onLogInClick = () => {
        let redirectTo = searchParams.get("redirectTo") ?? "/";
        router.push("/login?redirectTo=" + redirectTo);
    };

    const onSignUpClick = () => {
        // Unlike login, a brand-new signup should land the user on their own new profile
        // (see check-email/page.tsx's continueUrl) — only carry a redirectTo through if the
        // current page actually has one, don't invent "/" as a fallback destination.
        const redirectTo = searchParams.get("redirectTo");
        router.push(redirectTo ? "/signup/pilot?redirectTo=" + redirectTo : "/signup/pilot");
    };

    // hide when in the welcome screen
    if (pathname?.startsWith("/signup") || pathname === "/login") {
        return null;
    }

    if (!isMounted) {
        return null;
    }

    const isMobileExplore = isMobile && pathname === "/explore";
    const managedIdentities = getManagedIdentities(user);
    const hasIdentityChoices = managedIdentities.length > 0;

    const openProfile = (target: Circle) => {
        router.push(getCircleDefaultPath(target));
    };

    // Two distinct affordances per row, not one: clicking the name/avatar navigates to
    // that profile (openProfile), while this control is the only thing that changes who
    // you're acting as. `actAsTarget` is undefined for the personal-profile row (acting
    // as yourself isn't "acting as a circle").
    const renderCurrentOrActAs = (target: Circle, actAsTarget: Circle | undefined) => {
        const isCurrent = currentVisibleIdentity?._id === target._id;
        if (isCurrent) {
            return (
                <div className="flex shrink-0 items-center gap-1 text-xs font-medium text-[#1f6b45]">
                    <Check className="h-3.5 w-3.5" />
                    Current
                </div>
            );
        }
        return (
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={(e) => {
                    e.stopPropagation();
                    setActingIdentity(actAsTarget);
                }}
            >
                Act as
            </Button>
        );
    };

    // Visual-identity pilot (see pilot-chrome.ts): only on this one page does the profile
    // menu's icon buttons pick up the new palette, via globals.css's ".pilot-chrome" rules.
    const isPilotRoute = isPilotChromePath(pathname);

    // Rendered either portaled into the mobile Explore search bar's trailing-end slot
    // (the normal case) or in place here — which lands it in the fixed top-right
    // corner, same as before this feature — whenever that slot isn't currently mounted
    // (e.g. the swipe-cards view, where the search bar doesn't render at all; see
    // map-explorer.tsx). NOT used while the UserToolbox panel is open on mobile — see
    // the render site below, which suppresses this entirely in that state instead of
    // falling back to it, since the panel already shows its own avatar/name and this
    // fixed-position copy only collided with the panel's "Sign out" button.
    const mobileExploreFanOut = user && (
        <div ref={mobileFanRef} className="flex items-center gap-1">
            <AnimatePresence>
                {mobileIconsExpanded && (
                    <>
                        <motion.div
                            key="fan-chat"
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.5 }}
                            transition={{ duration: 0.3, ease: "easeOut", delay: 0 * 0.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <Button
                                variant="ghost"
                                size="icon"
                                className="relative h-9 w-9 rounded-full bg-[#f1f1f1] hover:bg-[#cecece]"
                                onClick={() => {
                                    setMobileIconsExpanded(false);
                                    openUserToolbox("chat");
                                }}
                            >
                                <LuMail className="h-5 w-5" />
                                <UnreadCountBadge count={messageUnreadCount} />
                            </Button>
                        </motion.div>
                        <motion.div
                            key="fan-events"
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.5 }}
                            transition={{ duration: 0.3, ease: "easeOut", delay: 1 * 0.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <Button
                                variant="ghost"
                                size="icon"
                                className="relative h-9 w-9 rounded-full bg-[#f1f1f1] hover:bg-[#cecece]"
                                onClick={() => {
                                    setMobileIconsExpanded(false);
                                    openUserToolbox("events");
                                }}
                            >
                                <LuClipboardCheck className="h-5 w-5" />
                            </Button>
                        </motion.div>
                        <motion.div
                            key="fan-notifications"
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.5 }}
                            transition={{ duration: 0.3, ease: "easeOut", delay: 2 * 0.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <Button
                                variant="ghost"
                                size="icon"
                                className="relative h-9 w-9 rounded-full bg-[#f1f1f1] hover:bg-[#cecece]"
                                onClick={() => {
                                    setMobileIconsExpanded(false);
                                    openUserToolbox("notifications");
                                }}
                            >
                                <Bell className="h-5 w-5" />
                                <UnreadCountBadge count={notificationUnreadCount} />
                            </Button>
                        </motion.div>
                        <motion.div
                            key="fan-profile-switcher"
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.5 }}
                            transition={{ duration: 0.3, ease: "easeOut", delay: 3 * 0.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            {hasIdentityChoices ? (
                                <Popover
                                    open={profileSwitcherOpen}
                                    onOpenChange={(open) => {
                                        setProfileSwitcherOpen(open);
                                        if (!open) setMobileIconsExpanded(false);
                                    }}
                                >
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="relative h-9 w-9 rounded-full bg-[#f1f1f1] hover:bg-[#cecece]"
                                        >
                                            <UserRound className="h-5 w-5" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent align="end" className="w-80 p-2">
                                        <IdentitySwitcherPopoverContent
                                            user={user}
                                            managedIdentities={managedIdentities}
                                            openProfile={openProfile}
                                            renderCurrentOrActAs={renderCurrentOrActAs}
                                            onGoToProfiles={() => router.push("/profiles")}
                                        />
                                    </PopoverContent>
                                </Popover>
                            ) : (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="relative h-9 w-9 rounded-full bg-[#f1f1f1] hover:bg-[#cecece]"
                                    onClick={() => {
                                        setMobileIconsExpanded(false);
                                        openProfile(currentVisibleIdentity ?? user);
                                    }}
                                >
                                    <UserRound className="h-5 w-5" />
                                </Button>
                            )}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <Button
                className="relative h-auto w-auto rounded-full p-0"
                variant="ghost"
                onClick={() => setMobileIconsExpanded((expanded) => !expanded)}
            >
                <UserPicture
                    name={currentVisibleIdentity?.name ?? user.name}
                    picture={
                        currentVisibleIdentity && isPeerifyManagedIdentity(currentVisibleIdentity)
                            ? getPeerifyIdentityAvatarUrl(currentVisibleIdentity)
                            : (user.picture?.url ?? PEERIFY_DEFAULT_PROFILE_AVATAR_URL)
                    }
                    size="40px"
                    circleType={currentVisibleIdentity?.circleType ?? "user"}
                />
                {/* Fanned-out icons carry their own individual badges (above) while expanded, so
                    the combined summary dot would double up that information — only show it
                    collapsed. */}
                {!mobileIconsExpanded && <UnreadCountBadge count={messageUnreadCount + notificationUnreadCount} />}
            </Button>
        </div>
    );

    return (
        <div className={cn("flex items-center justify-center gap-1 overflow-visible", isPilotRoute && "pilot-chrome")}>
            <>
                <div className="flex items-center space-x-2">
                    {authInfo.authStatus === "unauthenticated" && (
                        <div className="flex flex-row gap-2">
                            <Button
                                className="h-full w-full bg-[#00000077] text-white"
                                onClick={onLogInClick}
                                variant="outline"
                            >
                                Log in
                            </Button>
                            <Button className="h-full w-full" onClick={onSignUpClick} variant="outline">
                                Sign up
                            </Button>
                        </div>
                    )}

                    {authInfo.authStatus === "authenticated" && user && (
                        <>
                            {!isMobileExplore && (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="relative h-9 w-9 rounded-full bg-[#f1f1f1] hover:bg-[#cecece]"
                                        onClick={() => router.push("/chat")}
                                    >
                                        <LuMail className="h-5 w-5" />
                                        <UnreadCountBadge count={messageUnreadCount} />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="relative h-9 w-9 rounded-full bg-[#f1f1f1] hover:bg-[#cecece]"
                                        onClick={() => openUserToolbox("events")}
                                    >
                                        <LuClipboardCheck className="h-5 w-5" />
                                    </Button>

                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="relative h-9 w-9 rounded-full bg-[#f1f1f1] hover:bg-[#cecece]"
                                        onClick={() => openUserToolbox("notifications")}
                                    >
                                        <Bell className="h-5 w-5" />
                                        <UnreadCountBadge count={notificationUnreadCount} />
                                    </Button>
                                </>
                            )}

                            {isMobileExplore &&
                                (mobileExploreAvatarSlot
                                    ? createPortal(mobileExploreFanOut, mobileExploreAvatarSlot)
                                    : sidePanelContentVisible === "toolbox"
                                      ? null
                                      : mobileExploreFanOut)}

                            {!isMobileExplore && (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button className="relative h-auto w-auto rounded-full p-0" variant="ghost">
                                            <UserPicture
                                                name={currentVisibleIdentity?.name ?? user.name}
                                                picture={
                                                    currentVisibleIdentity &&
                                                    isPeerifyManagedIdentity(currentVisibleIdentity)
                                                        ? getPeerifyIdentityAvatarUrl(currentVisibleIdentity)
                                                        : (user.picture?.url ?? PEERIFY_DEFAULT_PROFILE_AVATAR_URL)
                                                }
                                                size="40px"
                                                circleType={currentVisibleIdentity?.circleType ?? "user"}
                                            />
                                            {hasIdentityChoices && (
                                                <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-white bg-[#231f1a] text-white shadow-sm">
                                                    <ChevronDown className="h-3 w-3" />
                                                </span>
                                            )}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent align="end" className="w-80 p-2">
                                        <IdentitySwitcherPopoverContent
                                            user={user}
                                            managedIdentities={managedIdentities}
                                            openProfile={openProfile}
                                            renderCurrentOrActAs={renderCurrentOrActAs}
                                            onGoToProfiles={() => router.push("/profiles")}
                                        />
                                    </PopoverContent>
                                </Popover>
                            )}
                        </>
                    )}
                </div>
            </>
        </div>
    );
};

export const ProfileMenu = () => {
    const [loadStateKey, setLoadStateKey] = useState(Date.now().toString());

    useEffect(() => {
        if (logLevel >= LOG_LEVEL_TRACE) {
            console.log("useEffect.ProfileMenu.1");
        }

        // Force re-render after component mount to ensure proper hydration
        const timer = setTimeout(() => {
            setLoadStateKey(Date.now().toString());
        }, 100);

        return () => clearTimeout(timer);
    }, []);

    return (
        <Suspense fallback={<div className="h-10 w-10"></div>}>
            <ProfileMenuBar key={loadStateKey} />
        </Suspense>
    );
};
