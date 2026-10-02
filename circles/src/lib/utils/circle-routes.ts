import type { Circle } from "@/models/models";

type CircleRouteTarget = Pick<Circle, "handle" | "enabledModules">;

export const getDefaultCircleModule = (enabledModules?: string[]): string => {
    if (enabledModules?.includes("home")) {
        return "home";
    }

    return enabledModules?.[0] ?? "home";
};

export const getCircleDefaultPath = (circle: CircleRouteTarget): string => {
    return `/circles/${circle.handle}/${getDefaultCircleModule(circle.enabledModules)}`;
};

// Lives outside /circles/ on purpose: middleware only runs /api/access for /circles/ paths, and
// that would 404 the invitee on an unpublished circle. The page does its own invitee-only check.
export const getAdminInvitationPath = (invitationId: string): string => `/invitations/admin/${invitationId}`;
