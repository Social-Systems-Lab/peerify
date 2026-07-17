"use client";

import { useIsCompact } from "@/components/utils/use-is-compact";
import { Circle, UserAndCircleInfo } from "@/models/models";
import { FormNav, NavItem } from "@/components/forms/form-nav";
import { useAtom } from "jotai";
import { userAtom } from "@/lib/data/atoms";
import { getUserOrCircleInfo } from "@/lib/utils/form";
import { usePathname } from "next/navigation";

type SettingsForm = {
    name: string | UserAndCircleInfo;
    handle: string;
};

const settingsForms: SettingsForm[] = [
    {
        name: "About",
        handle: "about",
    },
    {
        name: {
            user: "Offers",
            circle: "Offers and needs",
        },
        handle: "presence",
    },
    {
        name: "Modules",
        handle: "pages",
    },
    {
        name: "User Groups",
        handle: "user-groups",
    },
    {
        name: "Access Rules",
        handle: "access-rules",
    },
    {
        name: "Follow Requests",
        handle: "membership-requests",
    },
    {
        name: "Questionnaire",
        handle: "questionnaire",
    },
    {
        name: "Server",
        handle: "server-settings",
    },
    {
        name: "Account Settings",
        handle: "subscription",
    },
    {
        name: "General",
        handle: "general",
    },
];

export type SettingsLayoutWrapperProps = {
    circle: Circle;
    children: React.ReactNode;
};

export const SettingsLayoutWrapper = ({ children, circle }: SettingsLayoutWrapperProps) => {
    const isCompact = useIsCompact();
    const isUser = circle.circleType === "user";
    const [user] = useAtom(userAtom);
    const pathname = usePathname();
    const hideSettingsNav = pathname.endsWith("/settings/pledges");
    const navItems = settingsForms
        .filter((item) => {
            if (item.handle === "subscription") {
                return user?.handle === circle.handle;
            }

            // Hidden per request: re-enable by removing this block
            if (item.handle === "presence" || item.handle === "questionnaire") {
                return false;
            }

            // De-Kamooni: personal profiles aren't communities — hide circle-management
            // chrome that doesn't apply to an individual (Peerify has no "your circle" for fans).
            if (
                isUser &&
                (item.handle === "pages" ||
                    item.handle === "user-groups" ||
                    item.handle === "access-rules" ||
                    item.handle === "membership-requests")
            ) {
                return false;
            }

            return true;
        })
        .map((item) => ({
            name: getUserOrCircleInfo(item.name, isUser),
            handle: item.handle,
        })) as NavItem[];

    return (
        <div
            className="relative z-10 flex w-full"
            style={{
                flexDirection: isCompact ? "column" : "row",
                paddingTop: isCompact ? "0" : "20px",
            }}
        >
            {!hideSettingsNav && (
                <div
                    className="relative z-10 flex flex-col items-center pb-2"
                    style={{
                        flex: isCompact ? "0" : "1",
                        alignItems: isCompact ? "normal" : "flex-end",
                        minWidth: isCompact ? "0px" : "272px",
                        paddingLeft: isCompact ? "0px" : "16px",
                    }}
                >
                    <FormNav items={navItems} circle={circle} />
                </div>
            )}
            {children}
        </div>
    );
};
