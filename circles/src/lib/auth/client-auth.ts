import { Circle, Feature, MemberDisplay, UserPrivate } from "@/models/models";
import { features, maxAccessLevel } from "../data/constants";
import { isVerifiedUser } from "./verification";

export const getMemberAccessLevel = (user: UserPrivate | MemberDisplay | undefined, circle: Circle): number => {
    if (!user) return maxAccessLevel;

    let userGroups: string[] | undefined;
    if ("memberships" in user) {
        userGroups = user.memberships?.find((c) => c.circleId === circle._id)?.userGroups;
    } else {
        userGroups = user.userGroups;
    }
    if (!userGroups || userGroups.length <= 0) return maxAccessLevel;

    return Math.min(
        ...userGroups?.map((x) => circle?.userGroups?.find((grp) => grp.handle === x)?.accessLevel ?? maxAccessLevel),
    );
};

// returns true if user has higher access than the member (lower access level = higher access)
export const hasHigherAccess = (
    user: UserPrivate | undefined,
    member: MemberDisplay | null,
    circle: Circle,
    acceptSameLevel: boolean,
): boolean => {
    if (!member) return false;

    const userAccessLevel = getMemberAccessLevel(user, circle);
    const memberAccessLevel = getMemberAccessLevel(member, circle);

    if (acceptSameLevel) {
        return userAccessLevel <= memberAccessLevel;
    } else {
        return userAccessLevel < memberAccessLevel;
    }
};

/**
 * Check if a user is authorized to access a feature
 * @param user The user to check
 * @param circle The circle to check
 * @param feature The feature to check, can be a Feature object or a string in format "moduleHandle.featureHandle" or just "featureHandle" for general features
 * @returns True if the user is authorized, false otherwise
 */
/**
 * Same access-rule/user-group resolution as isAuthorized, but without the
 * needsToBeVerified/isVerifiedUser gate — for callers that need to
 * distinguish "has circle-level permission for this feature" from "is also
 * participation-ready" (e.g. Community's guarded composer/comment/reaction
 * states). isAuthorized itself is unchanged; it simply delegates here after
 * its verification check.
 */
export const hasFeatureAccessIgnoringVerification = (
    user: UserPrivate | undefined,
    circle: Circle,
    feature: Feature,
): boolean => {
    let moduleHandle: string;
    let featureHandle: string;

    // It's a Feature object
    moduleHandle = feature.module;
    featureHandle = feature.handle;

    // Get the access rules for this circle
    const accessRules = circle.accessRules;
    if (!accessRules) return false;

    // Get the module rules
    const moduleRules = accessRules[moduleHandle];
    if (!moduleRules) {
        // Module not found in access rules, use default
        return getDefaultAllowedUserGroups(moduleHandle, featureHandle, user, circle);
    }

    // Get the feature rules
    const allowedUserGroups = moduleRules[featureHandle];
    if (!allowedUserGroups) {
        // Feature not found in module rules, use default
        return getDefaultAllowedUserGroups(moduleHandle, featureHandle, user, circle);
    }

    // Check if everyone is allowed
    if (allowedUserGroups.includes("everyone")) return true;

    // Check if the user is a member of the circle
    const membership = user?.memberships?.find((c) => c.circleId === circle._id);
    if (!membership) return false;

    // Check if the user is in any of the allowed user groups
    return allowedUserGroups.some((group) => membership.userGroups.includes(group));
};

export const isAuthorized = (user: UserPrivate | undefined, circle: Circle, feature: Feature): boolean => {
    if (feature.needsToBeVerified && !isVerifiedUser(user) && user?._id !== circle._id) {
        return false;
    }

    return hasFeatureAccessIgnoringVerification(user, circle, feature);
};

/**
 * "Is the viewer the owner of this circle, or an admin of it" — the same
 * self-check + admins-group-membership combination already used to gate
 * About-editing UI (see AboutPage.tsx's isOwner/canEditAbout), but built on
 * hasFeatureAccessIgnoringVerification rather than isAuthorized so it isn't
 * itself gated by the circle's own verification state — otherwise an
 * unverified owner/admin would never see owner/admin-only UI *about* their
 * own unverified state (e.g. the participation-readiness completion banner).
 */
export const isOwnerOrCircleAdmin = (user: UserPrivate | undefined, circle: Circle): boolean => {
    if (user?.did === circle.did) return true;
    return hasFeatureAccessIgnoringVerification(user, circle, features.settings.edit_about);
};

/**
 * Get the default allowed user groups for a feature
 * @param moduleHandle The module handle
 * @param featureHandle The feature handle
 * @param user The user to check
 * @param circle The circle to check
 * @returns True if the user is authorized by default, false otherwise
 */
function getDefaultAllowedUserGroups(
    moduleHandle: string,
    featureHandle: string,
    user: UserPrivate | undefined,
    circle: Circle,
): boolean {
    // Try to get the feature from the features object
    const moduleFeatures = features[moduleHandle as keyof typeof features];
    if (moduleFeatures && typeof moduleFeatures === "object") {
        // Need to cast to any to avoid TypeScript errors with nested object access
        const featureObj = (moduleFeatures as any)[featureHandle];
        if (featureObj && featureObj.defaultUserGroups) {
            const defaultUserGroups = featureObj.defaultUserGroups as string[];

            // Check if everyone is allowed
            if (defaultUserGroups.includes("everyone")) return true;

            // Check if the user is a member of the circle
            const membership = user?.memberships?.find((c) => c.circleId === circle._id);
            if (!membership) return false;

            // Check if the user is in any of the allowed user groups
            return defaultUserGroups.some((group) => membership.userGroups.includes(group));
        }
    }

    // No default user groups found, deny access
    return false;
}

/**
 * Check if a module is enabled for a circle
 * @param circle The circle to check
 * @param moduleHandle The module handle to check
 * @returns True if the module is enabled, false otherwise
 */
export const isModuleEnabled = (circle: Circle, moduleHandle: string): boolean => {
    // Community and Crew used to be force-enabled here regardless of the stored
    // enabledModules array (backfill-avoidance hacks from when those modules first shipped).
    // Every circle has since been backfilled to actually store them, and new circles get them
    // set at creation (createCircle() in circle.ts), so enabledModules below is now the single
    // source of truth for both — same as every other module. This function is the single
    // choke point checked by both circle-tabs.tsx's tab bar and the /api/access middleware
    // route guard, so fixing it here covers the actual page route, not just the tab.
    //
    // Crew still has a second, independent control on top of that: the About settings page's
    // crewEnabled boolean (CrewEnabledToggle), which also gates Crew UI elsewhere (profile
    // preview, home widgets) — so an explicit crewEnabled === false must still win even if
    // "crew" is present in enabledModules.
    if (moduleHandle === "crew" && circle.crewEnabled === false) {
        return false;
    }

    // First check enabledModules array if it exists
    if (circle.enabledModules && circle.enabledModules.length > 0) {
        return circle.enabledModules.includes(moduleHandle);
    }

    // Default to false if no enabledModules or pages
    return false;
};

/**
 * Get all enabled modules for a circle
 * @param circle The circle to check
 * @returns Array of enabled module handles
 */
export const getEnabledModules = (circle: Circle): string[] => {
    // First check enabledModules array if it exists
    if (circle.enabledModules && circle.enabledModules.length > 0) {
        return circle.enabledModules;
    }

    // Default to empty array if no enabledModules or pages
    return [];
};
