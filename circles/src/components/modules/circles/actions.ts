"use server";

import { deleteCircle, getCircleById, getDefaultCircle } from "@/lib/data/circle";
import { getServerSettings } from "@/lib/data/server-settings";
import { FormSubmitResponse } from "@/models/models";
import { revalidatePath } from "next/cache";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { Feeds, Members, Posts } from "@/lib/data/db";
import { getSoleAdminCircles } from "@/lib/data/member";
import { features } from "@/lib/data/constants";
import { eraseAccount, planAccountErasure } from "@/lib/data/account-erasure";
import { getAuthCookieNamesForClearing } from "@/lib/auth/cookie";
import { cookies } from "next/headers";

// A personal profile's own artist circles (auto-created at signup, no other members) are erased
// with the account (account-erasure.ts), so being their only admin doesn't block deleting it.
const getBlockingSoleAdminCircles = async (circle: { _id?: unknown; did?: string; circleType?: string }) => {
    if (!circle.did) return [];
    const soleAdminCircles = await getSoleAdminCircles(circle.did, String(circle._id));
    if (circle.circleType !== "user" || soleAdminCircles.length === 0) return soleAdminCircles;
    const { ownCircleIds } = await planAccountErasure(circle.did);
    return soleAdminCircles.filter((c) => !ownCircleIds.includes(String(c._id)));
};

/**
 * Get statistics about what will be deleted when a circle is deleted
 * @param circleId The ID of the circle
 * @returns Object containing counts of members, feeds, and posts
 */
export async function getCircleDeletionStatsAction(circleId: string) {
    try {
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) {
            return {
                success: false,
                message: "You need to be logged in to view deletion statistics",
            };
        }

        // Same permission deleteCircleAction requires
        const canDelete = await isAuthorized(userDid, circleId, features.communities.delete);
        if (!canDelete) {
            return {
                success: false,
                message: "You don't have permission to view deletion statistics for this circle.",
            };
        }

        // Get the circle to be deleted
        const circle = await getCircleById(circleId);
        if (!circle) {
            throw new Error("Circle not found");
        }

        // Same owner-only rule deleteCircleAction applies to personal profiles
        if (circle.circleType === "user" && circle.did !== userDid) {
            return {
                success: false,
                message: "You don't have permission to view deletion statistics for this circle.",
            };
        }

        // Count members
        const membersCount = await Members.countDocuments({ circleId });

        // Count feeds and posts
        const feeds = await Feeds.find({ circleId }).toArray();
        const feedIds = feeds.map((feed) => feed._id.toString());
        const feedsCount = feeds.length;

        // Count posts across all feeds
        let postsCount = 0;
        for (const feedId of feedIds) {
            const count = await Posts.countDocuments({ feedId });
            postsCount += count;
        }

        // Check if this is a user account
        const isUser = circle.circleType === "user";

        // Phase 0 fix (see SESSION_LOG.md — orphaned-circles investigation): surfaced here too,
        // proactively, as soon as the delete dialog opens — not just as a failure message after
        // someone types the confirmation name — since this stats fetch already runs at exactly
        // that moment (see DeleteCircleButton).
        const soleAdminCircles = await getBlockingSoleAdminCircles(circle);

        return {
            success: true,
            stats: {
                membersCount,
                feedsCount,
                postsCount,
                isUser,
                soleAdminCircles,
            },
        };
    } catch (error) {
        console.error("Error getting circle deletion stats:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "An unknown error occurred",
        };
    }
}

// This is a separate action for deleting a circle
export async function deleteCircleAction(circleId: string, confirmationName: string): Promise<FormSubmitResponse> {
    try {
        // Get authenticated user DID
        const userDid = await getAuthenticatedUserDid();
        if (!userDid) {
            return {
                success: false,
                message: "You need to be logged in to delete a circle",
            };
        }

        // Get the circle to be deleted
        const circle = await getCircleById(circleId);
        if (!circle) {
            return {
                success: false,
                message: "Circle not found",
            };
        }

        // Check if this is the default circle (which shouldn't be deletable)
        const serverSettings = await getServerSettings();
        const defaultCircle = await getDefaultCircle(serverSettings);

        if (defaultCircle._id === circleId) {
            return {
                success: false,
                message: "Cannot delete the default circle",
            };
        }

        // A personal profile is its owner's account: only the owner can delete it, whatever
        // groups anyone else holds on it.
        if (circle.circleType === "user" && circle.did !== userDid) {
            return {
                success: false,
                message: "Only the owner can delete this account.",
            };
        }

        // Check if user has admin permissions for this circle
        const isAdmin = await isAuthorized(userDid, circleId, features.communities.delete);
        if (!isAdmin) {
            return {
                success: false,
                message: "You don't have permission to delete this circle. Only admins can delete circles.",
            };
        }

        // Phase 0 fix (see SESSION_LOG.md — orphaned-circles investigation): deleteCircle's own
        // otherMemberships cleanup strips this circle's did from every OTHER circle it's a
        // member of, with no check for whether that leaves any of them with zero admins —
        // completely bypassing the "cannot remove the last admin" rule removeMemberAction
        // already enforces for direct membership removal. Block here instead, before deletion
        // ever starts, using the same countAdmins-based rule via the shared getSoleAdminCircles
        // helper (excludeCircleId skips the circle being deleted itself).
        if (circle.did) {
            const soleAdminCircles = await getBlockingSoleAdminCircles(circle);
            if (soleAdminCircles.length > 0) {
                const circleNames = soleAdminCircles.map((c) => c.name || c.handle || "an unnamed circle").join(", ");
                return {
                    success: false,
                    message: `You're the only admin of ${circleNames}. Please transfer ownership or remove ${
                        soleAdminCircles.length === 1 ? "this circle" : "these circles"
                    } before deleting this account.`,
                    data: { soleAdminCircles },
                };
            }
        }

        // Verify the confirmation name matches the circle name
        if (confirmationName !== circle.name) {
            return {
                success: false,
                message: "Confirmation name does not match circle name",
            };
        }

        // A personal profile is the account: erase everything the person created or that is about
        // them (account-erasure.ts), then end their session. Other circles keep the circle delete.
        if (circle.circleType === "user" && circle.did) {
            await eraseAccount(circle.did);
            const cookieStore = await cookies();
            for (const cookieName of getAuthCookieNamesForClearing()) {
                cookieStore.set(cookieName, "", {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: "lax",
                    path: "/",
                    maxAge: 0,
                });
            }
            revalidatePath("/");
            return {
                success: true,
                message: "Your account and everything in it has been deleted.",
                data: { redirectTo: "/", accountDeleted: true },
            };
        }

        // Delete the circle
        await deleteCircle(circleId);

        // Revalidate paths
        revalidatePath("/circles");
        revalidatePath(`/circles/${circle.handle}`);

        return {
            success: true,
            message: "Circle deleted successfully",
            data: { redirectTo: "/circles" },
        };
    } catch (error) {
        console.error("Error deleting circle:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "An unknown error occurred",
        };
    }
}
