"use client";

import Image from "next/image";
import Link from "next/link";
import { Shield } from "lucide-react";
import GlobalNavItems from "./global-nav-items";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { useEffect } from "react";
import { LOG_LEVEL_TRACE, logLevel } from "@/lib/data/constants";

import { usePathname } from "next/navigation";
import { useIsMobile } from "@/components/utils/use-is-mobile";

export default function GlobalNav() {
    const [user, setUser] = useAtom(userAtom);
    const pathname = usePathname();
    const isMobile = useIsMobile();
    useEffect(() => {
        if (logLevel >= LOG_LEVEL_TRACE) {
            console.log("useEffect.GlobalNav.1");
        }
    }, []);

    const hideNavForRoutes = ["/", "/welcome", "/holding", "/donations", "/supporter", "/donate"];

    if (pathname && hideNavForRoutes.includes(pathname)) {
        return null;
    }

    const mobileNavHeight = 56; // px

    return (
        <>
            <div
                className={`order-last w-full flex-shrink-0 md:order-first md:h-full md:w-[72px]`}
                style={
                    isMobile
                        ? { height: `calc(${mobileNavHeight}px + env(safe-area-inset-bottom, 0px))` }
                        : undefined
                }
            ></div>
            <div
                className={`fixed bottom-0 z-[300] w-full bg-[#181512] text-[#faf6ef] shadow-md md:top-0 md:h-full md:w-[72px] md:border-r md:border-[#2b251f] md:shadow-none`}
                style={
                    isMobile
                        ? {
                              height: `calc(${mobileNavHeight}px + env(safe-area-inset-bottom, 0px))`,
                              paddingBottom: "env(safe-area-inset-bottom, 0px)",
                          }
                        : undefined
                }
            >
                <div className={`flex h-[56px] flex-row items-center justify-center md:h-auto md:w-[72px] md:flex-col`}>
                    <Link href="/circles/the-backstage-lounge" aria-label="The Backstage Lounge">
                        <div className="group relative ml-4 mr-4 hidden flex-shrink-0 flex-col items-center justify-center md:mb-4 md:ml-0 md:mr-0 md:mt-4 md:flex">
                            <div className="relative">
                                <div className="relative h-[50px] w-[50px] transform cursor-pointer">
                                    <Image
                                        src={"/peerify/logo-mark.png"}
                                        alt="Peerify"
                                        className="h-[50px] w-[50px] object-contain"
                                        width={100}
                                        height={100}
                                        priority
                                    />
                                </div>
                            </div>
                        </div>
                    </Link>

                    <GlobalNavItems />
                </div>

                {/* Platform-superadmin only (user.isAdmin — the same gate as /admin's own
                    server-side check and every admin action in src/components/modules/admin,
                    distinct from a circle's own admins userGroups membership), desktop only. */}
                {user?.isAdmin && (
                    <Link
                        href="/admin"
                        aria-label="Admin dashboard"
                        className="hidden md:absolute md:bottom-4 md:left-0 md:right-0 md:flex md:flex-col md:items-center md:justify-center"
                    >
                        <div className="flex flex-shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg text-[#b9afa2] transition-colors hover:bg-[#241f1a] hover:text-[#ff8c2a] md:w-[64px] md:pb-2 md:pt-2">
                            <Shield size={24} />
                            <span className="mt-[2px] text-[11px]">Admin</span>
                        </div>
                    </Link>
                )}
            </div>
        </>
    );
}
