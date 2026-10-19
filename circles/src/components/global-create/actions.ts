"use server";

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { canPerformRestrictedAction } from "@/lib/auth/verification";
import { features } from "@/lib/data/constants";
import { getCirclesByIds, resolveViewerIsAdmin } from "@/lib/data/circle";
import { Members } from "@/lib/data/db";
import { getUserPrivate } from "@/lib/data/user";
import { toPublicCircle } from "@/lib/utils/public-circle";
import { Circle, Feature } from "@/models/models";

type GetSelectableCirclesActionResult = {
    success: boolean;
    circles: Circle[];
};

export async function getSelectableCirclesAction(
    moduleHandle: string,
    createFeatureHandle: string,
    permissionModuleHandle = moduleHandle,
    requireModuleEnabled = false,
    requiredEnabledModuleHandle = moduleHandle,
    // Overrides the (permissionModuleHandle, createFeatureHandle) lookup below with a specific
    // Feature when the caller needs a different gate than "create" implies — e.g. the circle
    // wizard's parent-circle picker uses features.settings.edit_about (admins only) instead of
    // features.communities.create (admins+moderators+members), since only circle admins should
    // be able to create a new circle underneath one.
    permissionFeature?: Feature,
): Promise<GetSelectableCirclesActionResult> {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, circles: [] };
    }

    const user = await getUserPrivate(userDid);
    if (!canPerformRestrictedAction(user)) {
        return { success: true, circles: [] };
    }

    const memberships = await Members.find({ userDid }, { projection: { circleId: 1 } }).toArray();
    const featureToAuth =
        permissionFeature ??
        ((features[permissionModuleHandle as keyof typeof features] as any)?.[createFeatureHandle] as
            | Feature
            | undefined);

    if (!featureToAuth) {
        return { success: false, circles: [] };
    }

    // Full documents here, shaped per circle below: the event form pre-fills a new event's location,
    // tags and currency from the picked host circle, so a circle this viewer manages comes back whole.
    const memberCircles = await getCirclesByIds(
        memberships
            .map((membership) => membership.circleId)
            .filter((circleId): circleId is string => Boolean(circleId && circleId !== user._id)),
        { viewerDid: userDid, includePrivate: true },
    );
    const candidateCircles = [user as Circle, ...memberCircles].filter(
        (circle, index, circles) => circles.findIndex((candidate) => candidate._id === circle._id) === index,
    );
    const moduleEligibleCircles = requireModuleEnabled
        ? candidateCircles.filter((circle) => circle.enabledModules?.includes(requiredEnabledModuleHandle))
        : candidateCircles;

    const authorizationChecks = await Promise.all(
        moduleEligibleCircles.map(async (circle) => {
            if (!circle?._id || !circle.handle) {
                return false;
            }

            if (circle.circleType === "user") {
                return circle._id === user._id;
            }

            return isAuthorized(userDid, circle._id, featureToAuth);
        }),
    );

    // Anyone who may create here but not manage the circle gets the public profile shape: no street
    // and no pin at all, so the event form pre-fills the city rather than saving a coarse grid point
    // as the new event's address. The viewer's own profile is theirs and stays whole.
    const viewerIsPlatformAdmin = await resolveViewerIsAdmin(userDid);
    const selectableCircles = await Promise.all(
        moduleEligibleCircles
            .filter((_, index) => authorizationChecks[index])
            .map(async (circle) => {
                if (circle._id === user._id) {
                    return circle;
                }
                const viewerCanManage = await isAuthorized(userDid, circle._id!, features.settings.edit_about);
                return toPublicCircle(circle, { viewerDid: userDid, viewerIsPlatformAdmin, viewerCanManage });
            }),
    );

    const circles = selectableCircles.sort((a, b) => {
        if (a._id === user._id) return -1;
        if (b._id === user._id) return 1;
        return (a.name || a.handle || "").localeCompare(b.name || b.handle || "");
    });

    return {
        success: true,
        circles: JSON.parse(JSON.stringify(circles)),
    };
}
