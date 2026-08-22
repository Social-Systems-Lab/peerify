"use server";

import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { getCirclePath, ensureCrewUserGroupOnCircle } from "@/lib/data/circle";
import { features } from "@/lib/data/constants";
import { getMember, addMember, updateMemberUserGroups, getCrewMembers } from "@/lib/data/member";
import {
    getAllCrewApplications,
    getCrewApplication,
    updatePendingCrewApplicationStatus,
} from "@/lib/data/crew-applications";
import { sendNotifications, buildNotificationBody } from "@/lib/data/notifications";
import { getUserPrivate } from "@/lib/data/user";
import { getFeedByHandle, createCrewFeed, createPost } from "@/lib/data/feed";
import { Circle, CrewApplication, Post, postSchema } from "@/models/models";
import { revalidatePath } from "next/cache";

type CrewApplicationsResponse = {
    success: boolean;
    message?: string;
    pendingApplications?: CrewApplication[];
    rejectedApplications?: CrewApplication[];
};

export const getAllCrewApplicationsAction = async (circleId: string): Promise<CrewApplicationsResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to view Crew applications" };
    }

    try {
        if (!circleId) {
            return { success: false, message: "Invalid circle ID" };
        }

        const authorized = await isAuthorized(userDid, circleId, features.general.manage_crew_applications);
        if (!authorized) {
            return { success: false, message: "You are not authorized to view Crew applications" };
        }

        const { pendingApplications, rejectedApplications } = await getAllCrewApplications(circleId);
        return { success: true, pendingApplications, rejectedApplications };
    } catch (error) {
        return { success: false, message: "Failed to fetch Crew applications. " + error?.toString() };
    }
};

type UpdateCrewApplicationResponse = {
    success: boolean;
    message?: string;
};

export const approveCrewApplicationAction = async (
    applicationId: string,
    circle: Circle,
    note?: string,
): Promise<UpdateCrewApplicationResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to approve Crew applications" };
    }

    try {
        const authorized = await isAuthorized(userDid, circle._id ?? "", features.general.manage_crew_applications);
        if (!authorized) {
            return { success: false, message: "You are not authorized to manage Crew applications" };
        }

        const application = await getCrewApplication(applicationId);
        const circleId = circle._id ?? "";

        // Self-heal: guarantee this circle has a "crew" userGroup before assigning anyone to it
        // — see ensureCrewUserGroupOnCircle for why this replaces a one-off migration.
        await ensureCrewUserGroupOnCircle(circleId);

        const existingMember = await getMember(application.userDid, circleId);
        if (existingMember) {
            const newGroups = Array.from(new Set([...(existingMember.userGroups ?? []), "crew", "members"]));
            await updateMemberUserGroups(application.userDid, circleId, newGroups);
        } else {
            await addMember(application.userDid, circleId, ["crew", "members"]);
        }

        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}`);

        await updatePendingCrewApplicationStatus(application._id!, "approved");

        const applicant = await getUserPrivate(application.userDid);
        if (applicant) {
            // Optional artist-written note, appended to the standard approval message rather than
            // replacing it — the applicant still sees the normal "You're now part of the Crew!"
            // confirmation, plus whatever the artist chose to add.
            const trimmedNote = note?.trim();
            const messageBody = trimmedNote
                ? `${buildNotificationBody("crew_application_approved", { circle })}\n\n"${trimmedNote}"`
                : undefined;
            await sendNotifications("crew_application_approved", [applicant], { circle, messageBody });
        }

        return { success: true };
    } catch (error) {
        return { success: false, message: "Failed to approve Crew application. " + error?.toString() };
    }
};

export const rejectCrewApplicationAction = async (
    applicationId: string,
    circle: Circle,
): Promise<UpdateCrewApplicationResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to reject Crew applications" };
    }

    try {
        const authorized = await isAuthorized(userDid, circle._id ?? "", features.general.manage_crew_applications);
        if (!authorized) {
            return { success: false, message: "You are not authorized to manage Crew applications" };
        }

        const application = await getCrewApplication(applicationId);

        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}`);

        await updatePendingCrewApplicationStatus(application._id!, "rejected");

        return { success: true };
    } catch (error) {
        return { success: false, message: "Failed to reject Crew application. " + error?.toString() };
    }
};

type BroadcastToCrewResponse = {
    success: boolean;
    message?: string;
    recipientCount?: number;
};

// Same permission as managing applications — whoever can approve/reject Crew applications can
// also message the Crew as a whole. Reuses sendNotifications' existing multi-recipient support
// (already dedupes by did and fans out one Notification doc + push per recipient) rather than
// introducing new fan-out logic. Deliberately independent of crewVisible: that flag only governs
// whether OTHER crew members can see a given member in the rail/offers list, not whether the
// artist can reach them — getCrewMembers doesn't filter on it, so neither does this.
//
// Every broadcast also creates a real, pinned Crew post authored as the circle (not just a
// notification with nothing behind it) — createdBy: circle.did directly, since resolveActingAuthor
// (used by the ordinary composer) resolves "posting as the circle" to exactly that, and this
// action already re-verifies authorization on its own. isCrewMessage distinguishes this from a
// post an admin manually authored-as-the-circle-and-pinned via the ordinary composer + pin action
// — those are both possible today and would otherwise look identical to a real broadcast.
// The notification's href/push URL deliberately do NOT use the generic /circles/{handle}/post/{postId}
// page that post_comment/post_like/etc. use — middleware.ts hardcodes any /post/{id} URL to require
// the Noticeboard ("feed") module specifically, regardless of the post's actual postType, so it
// 403s for a Crew post on any circle that hasn't separately enabled Noticeboard (confirmed live:
// even the circle's own admin got "Access denied: feed"). Fixing that is a global middleware change
// out of scope here. Instead this links straight to /circles/{handle}/crew#post-{postId} — Crew's
// own already-correctly-gated page — via payload.url, which both getNotificationHref
// (notifications.tsx) and resolvePushUrl (push.ts) already check before falling back to their type
// switch. crew-space.tsx scrolls to the matching post after its posts finish loading, since the
// hash is present before the client-fetched post list exists in the DOM.
export const broadcastToCrewAction = async (circle: Circle, message: string): Promise<BroadcastToCrewResponse> => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        return { success: false, message: "You need to be logged in to message the Crew" };
    }

    const trimmedMessage = message?.trim();
    if (!trimmedMessage) {
        return { success: false, message: "Message cannot be empty" };
    }

    const circleId = circle._id ?? "";

    try {
        const authorized = await isAuthorized(userDid, circleId, features.general.manage_crew_applications);
        if (!authorized) {
            return { success: false, message: "You are not authorized to message the Crew" };
        }

        const members = await getCrewMembers(circleId);
        const recipients = members.map((member) => ({ did: member.userDid }));

        if (recipients.length === 0) {
            return { success: false, message: "There are no Crew members to message yet" };
        }

        if (!circle.did) {
            return { success: false, message: "This circle can't author posts yet" };
        }

        // Lazy-create the crew feed, mirroring createPostAction's own handling — not guaranteed
        // to exist yet if this is the artist's first Crew action.
        let feed = await getFeedByHandle(circleId, "crew");
        if (!feed) {
            feed = await createCrewFeed(circleId);
            if (!feed) {
                return { success: false, message: "Failed to set up the Crew feed for this circle" };
            }
        }

        let post: Post = {
            content: trimmedMessage,
            feedId: feed._id.toString(),
            createdBy: circle.did,
            createdAt: new Date(),
            reactions: {},
            comments: 0,
            userGroups: ["admins", "moderators", "crew"],
            postType: "crew",
            pinned: true,
            isCrewMessage: true,
        };
        await postSchema.parseAsync(post);
        const newPost = await createPost(post);

        await sendNotifications("crew_broadcast", recipients, {
            circle,
            messageBody: trimmedMessage,
            url: `/circles/${circle.handle}/crew#post-${newPost._id}`,
            postId: newPost._id,
        });

        let circlePath = await getCirclePath(circle);
        revalidatePath(`${circlePath}crew`);

        return { success: true, recipientCount: recipients.length };
    } catch (error) {
        return { success: false, message: "Failed to send message to Crew. " + error?.toString() };
    }
};
