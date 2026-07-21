// profile-menu.tsx
"use client";

import React, { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "../ui/button";
import {
    userAtom,
    userToolboxDataAtom,
    sidePanelContentVisibleAtom,
    authInfoAtom,
    notificationUnreadCountAtom,
} from "@/lib/data/atoms";
import { useAtom } from "jotai";
import { UserPicture } from "../modules/members/user-picture";
import { Bell, Check, ChevronDown, ChevronRight } from "lucide-react";
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

const ProfileMenuBar = () => {
    const router = useRouter();
    const [authInfo] = useAtom(authInfoAtom);
    const [user] = useAtom(userAtom);
    const searchParams = useSearchParams();
    const [userToolboxState, setUserToolboxState] = useAtom(userToolboxDataAtom);
    const [sidePanelContentVisible] = useAtom(sidePanelContentVisibleAtom);
    const [notificationUnreadCount, setNotificationUnreadCount] = useAtom(notificationUnreadCountAtom);
    const [messageUnreadCount, setMessageUnreadCount] = useState(0);
    const pathname = usePathname();
    const isMobile = useIsMobile();
    const currentVisibleIdentity = useActingIdentity();
    const setActingIdentity = useSetActingIdentity();

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

    return (
        <div className="flex items-center justify-center gap-1 overflow-visible">
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
                                        {messageUnreadCount > 0 && (
                                            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white">
                                                {messageUnreadCount}
                                            </span>
                                        )}
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
                                        {notificationUnreadCount > 0 && (
                                            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white">
                                                {notificationUnreadCount}
                                            </span>
                                        )}
                                    </Button>
                                </>
                            )}

                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button className="relative h-auto w-auto rounded-full p-0" variant="ghost">
                                        <UserPicture
                                            name={currentVisibleIdentity?.name ?? user.name}
                                            picture={
                                                currentVisibleIdentity && isPeerifyManagedIdentity(currentVisibleIdentity)
                                                    ? getPeerifyIdentityAvatarUrl(currentVisibleIdentity)
                                                    : user.picture?.url ?? PEERIFY_DEFAULT_PROFILE_AVATAR_URL
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
                                                    <div className="truncate text-xs text-muted-foreground">
                                                        Personal profile
                                                    </div>
                                                </div>
                                            </button>
                                            {renderCurrentOrActAs(user, undefined)}
                                        </div>

                                        {managedIdentities.length > 0 && (
                                            <div className="mt-1 border-t pt-1">
                                                {managedIdentities.map((identity) => (
                                                    <div
                                                        key={identity._id}
                                                        className="flex w-full items-center gap-2 rounded-md p-2 hover:bg-muted"
                                                    >
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
                                                                <div className="truncate text-sm font-semibold">
                                                                    {identity.name}
                                                                </div>
                                                                <div className="truncate text-xs text-muted-foreground">
                                                                    Public profile
                                                                </div>
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
                                            onClick={() => router.push("/profiles")}
                                        >
                                            Go to profiles
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </PopoverContent>
                            </Popover>
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
