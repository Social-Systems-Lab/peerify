// member.ts - membership management
import { Content, FileInfo, Member, MemberDisplay, SortingOptions, TourTeamOffering } from "@/models/models";
import { ChatRoomMembers, Circles, Members } from "./db";
import { ObjectId } from "mongodb";
import { filterLocations } from "../utils";
import { getMetrics } from "../utils/metrics";
import { SAFE_CIRCLE_PROJECTION } from "./circle";
import { addChatRoomMember, getChatRoomByHandle, removeChatRoomMember } from "./chat";
import { upsertFollowState } from "./relationships";

export const getMember = async (userDid: string, circleId: string): Promise<Member | null> => {
    return await Members.findOne({ userDid: userDid, circleId: circleId });
};

export const isCircleAdmin = async (userDid: string, circleId: string): Promise<boolean> => {
    const member = await getMember(userDid, circleId);
    return !!member?.userGroups?.includes("admins");
};

// True if userDid administers at least one of the given circles. Used for permission checks that
// should pass if the user is an admin of ANY of a set of circles (e.g. any additional artist
// circle attached to an event), not a specific one.
export const isCircleAdminOfAny = async (userDid: string, circleIds?: string[]): Promise<boolean> => {
    if (!circleIds || circleIds.length === 0) return false;
    const results = await Promise.all(circleIds.map((circleId) => isCircleAdmin(userDid, circleId)));
    return results.some(Boolean);
};

export const getMembersWithMetrics = async (
    userDid: string | undefined,
    circleId?: string,
    sort?: SortingOptions,
): Promise<MemberDisplay[]> => {
    let members = await getMembers(circleId);

    const currentDate = new Date();
    let user = undefined;
    if (userDid) {
        user = (await Circles.findOne({ did: userDid }, { projection: SAFE_CIRCLE_PROJECTION })) ?? undefined;
    }

    // get metrics for each member
    for (const member of members) {
        member.metrics = await getMetrics(user, member, currentDate, sort);
    }

    // sort members by rank
    members.sort((a, b) => (a.metrics?.rank ?? 0) - (b.metrics?.rank ?? 0));
    return members;
};

export const getMembers = async (circleId?: string): Promise<MemberDisplay[]> => {
    if (!circleId) return [];

    let members = await Members.aggregate([
        { $match: { circleId: circleId } },
        {
            $lookup: {
                from: "circles",
                localField: "userDid",
                foreignField: "did",
                as: "userDetails",
            },
        },
        { $unwind: "$userDetails" },
        {
            $project: {
                _id: { $toString: "$_id" },
                userDid: 1,
                circleId: 1,
                userGroups: 1,
                joinedAt: 1,
                name: "$userDetails.name",
                picture: "$userDetails.picture",
                images: "$userDetails.images",
                location: "$userDetails.location",
                description: "$userDetails.description",
                members: "$userDetails.members",
                circleType: "$userDetails.circleType",
                handle: "$userDetails.handle",
                did: "$userDetails.did",
                searchable: "$userDetails.searchable",
                mapVisible: "$userDetails.mapVisible",
            },
        },
    ]).toArray();

    // filter location data based on precision
    //members = filterLocations(members as Content[]);
    return members as MemberDisplay[];
};

// Approved Crew members are just Members docs whose userGroups includes "crew" (assigned by
// approveCrewApplicationAction) — there's no separate "crew membership" collection, so this is
// getMembers filtered to that group plus the crewVisible flag projected through.
export const getCrewMembers = async (circleId?: string): Promise<MemberDisplay[]> => {
    if (!circleId) return [];

    let members = await Members.aggregate([
        { $match: { circleId: circleId, userGroups: "crew" } },
        {
            $lookup: {
                from: "circles",
                localField: "userDid",
                foreignField: "did",
                as: "userDetails",
            },
        },
        { $unwind: "$userDetails" },
        {
            $project: {
                _id: { $toString: "$_id" },
                userDid: 1,
                circleId: 1,
                userGroups: 1,
                joinedAt: 1,
                crewVisible: 1,
                name: "$userDetails.name",
                picture: "$userDetails.picture",
                handle: "$userDetails.handle",
                location: "$userDetails.location",
            },
        },
    ]).toArray();

    return members as MemberDisplay[];
};

export type CrewOfferer = {
    userDid: string;
    name: string;
    picture?: FileInfo;
    handle?: string;
    tourTeamOfferings: TourTeamOffering[];
};

// Crew Offers widget's data source — deliberately scoped to THIS circle's crew members only
// (same $match as getCrewMembers), never a global "all offers" query filtered down afterward.
// excludeUserDid drops the viewer's own entry (they already see their own offers on their own
// profile; this widget is about discovering peers'). Access control (who's allowed to call this
// at all) lives in the caller (getCrewOffersAction) — this function only decides what a caller
// with access sees, matching the existing getCrewMembers/getCrewProfileAccessAction split.
// bypassCrewVisible mirrors the same admin/moderator bypass isSuppressedCrewMember's caller
// applies to the member list — a peer viewer must not see an offer from someone who's hidden
// their profile from Crew peers (crewVisible: false), but the circle's own admins/moderators
// still see everything regardless of the toggle.
export const getCrewOfferings = async (
    circleId: string,
    excludeUserDid?: string,
    bypassCrewVisible: boolean = false,
): Promise<CrewOfferer[]> => {
    if (!circleId) return [];

    const match: Record<string, any> = { circleId, userGroups: "crew" };
    if (excludeUserDid) {
        match.userDid = { $ne: excludeUserDid };
    }
    if (!bypassCrewVisible) {
        // Same "missing/true counts as visible, only literal false is hidden" semantics as
        // isSuppressedCrewMember's member.crewVisible === false check.
        match.crewVisible = { $ne: false };
    }

    const offerers = await Members.aggregate([
        { $match: match },
        {
            $lookup: {
                from: "circles",
                localField: "userDid",
                foreignField: "did",
                as: "userDetails",
            },
        },
        { $unwind: "$userDetails" },
        // Only circle members who've actually set up at least one offering are relevant here.
        { $match: { "userDetails.tourTeamOfferings": { $exists: true, $not: { $size: 0 } } } },
        {
            $project: {
                _id: 0,
                userDid: 1,
                name: "$userDetails.name",
                picture: "$userDetails.picture",
                handle: "$userDetails.handle",
                tourTeamOfferings: "$userDetails.tourTeamOfferings",
            },
        },
    ]).toArray();

    return offerers as CrewOfferer[];
};

// Self-service only — callers must derive userDid from the authenticated viewer's own session,
// never accept it as a parameter from elsewhere, so a member can only toggle their own row.
export const setCrewVisibility = async (userDid: string, circleId: string, crewVisible: boolean): Promise<void> => {
    const result = await Members.updateOne({ userDid, circleId }, { $set: { crewVisible } });
    if (result.matchedCount === 0) {
        throw new Error("Member not found");
    }
};

export const addMember = async (
    userDid: string,
    circleId: string,
    userGroups: string[],
    answers?: Record<string, string>,
): Promise<Member> => {
    const circle = await Circles.findOne(
        { _id: new ObjectId(circleId) },
        { projection: { did: 1, circleType: 1 } },
    );
    if (!circle) {
        throw new Error("Circle not found");
    }

    const existingMember = await Members.findOne({ userDid: userDid, circleId: circleId });
    if (existingMember) {
        throw new Error("User is already a member of this circle");
    }

    // if circle has no members, add user as admin
    let memberCount = await Members.countDocuments({ circleId: circleId });
    if (memberCount === 0) {
        userGroups = ["admins", "moderators", "members"];
    }

    let member: Member = {
        userDid: userDid,
        circleId: circleId,
        userGroups: userGroups,
        joinedAt: new Date(),
        questionnaireAnswers: answers,
    };
    await Members.insertOne(member);

    // add member to chat
    await autoAddToMemberChats(userDid, circleId);

    // increase member count in circle
    await Circles.updateOne({ _id: new ObjectId(circleId) }, { $inc: { members: 1 } });

    if (circle.circleType === "user" && circle.did && circle.did !== userDid) {
        await upsertFollowState(userDid, circle.did, true);
    }

    return member;
};

export const removeMember = async (userDid: string, circleId: string): Promise<boolean> => {
    // ensure user can't be removed from their own circle
    const circle = await Circles.findOne({ _id: new ObjectId(circleId) });
    if (!circle) {
        throw new Error("Circle not found");
    }
    if (circle.did === userDid) {
        throw new Error("User can't leave their own circle");
    }

    let result = await Members.deleteOne({ userDid: userDid, circleId: circleId });
    if (result.deletedCount === 0) {
        throw new Error("User is not a member of this circle");
    }

    // decrease member count in circle
    await Circles.updateOne({ _id: new ObjectId(circleId) }, { $inc: { members: -1 } });

    // remove user from all chat rooms in the circle
    await ChatRoomMembers.deleteMany({ userDid: userDid, circleId: circleId });

    // remove member from members chat
    await autoRemoveFromMemberChats(userDid, circleId);

    if (circle.circleType === "user" && circle.did && circle.did !== userDid) {
        await upsertFollowState(userDid, circle.did, false);
    }

    return true;
};

export const updateMemberUserGroups = async (
    userDid: string,
    circleId: string,
    newGroups: string[],
): Promise<Member> => {
    let existingMember = await Members.findOne({ userDid: userDid, circleId: circleId });
    if (!existingMember) {
        throw new Error("Member not found");
    }

    let updatedMember: Member = {
        ...existingMember,
        userGroups: newGroups,
    };
    await Members.updateOne({ userDid: userDid, circleId: circleId }, { $set: updatedMember });
    return updatedMember;
};

export const countAdmins = async (circleId: string): Promise<number> => {
    return await Members.countDocuments({ circleId: circleId, userGroups: "admins" });
};

// Circles where `did` is currently the SOLE admin — i.e. removing this account/circle would
// leave that circle with zero admins. Mirrors the same "cannot remove the last admin" rule
// removeMemberAction already enforces for direct membership removal (via countAdmins above),
// reused here so account/circle deletion can't silently bypass it via a different code path
// (see deleteCircle in ./circle.ts, whose otherMemberships cleanup strips this same DID's
// membership from every circle it belongs to — including any it solely administers — with no
// such check today). excludeCircleId lets a caller skip the very circle being deleted itself,
// since that one ceasing to have this admin is expected, not a problem.
export const getSoleAdminCircles = async (
    did: string,
    excludeCircleId?: string,
): Promise<Array<{ _id: string; name?: string; handle?: string }>> => {
    const adminMemberships = await Members.find({ userDid: did, userGroups: "admins" }).toArray();
    const soleAdminCircles: Array<{ _id: string; name?: string; handle?: string }> = [];

    for (const membership of adminMemberships) {
        if (excludeCircleId && membership.circleId === excludeCircleId) continue;

        const adminCount = await countAdmins(membership.circleId);
        if (adminCount <= 1) {
            const circle = await Circles.findOne(
                { _id: new ObjectId(membership.circleId) },
                { projection: { name: 1, handle: 1 } },
            );
            if (circle) {
                soleAdminCircles.push({ _id: membership.circleId, name: circle.name, handle: circle.handle });
            }
        }
    }

    return soleAdminCircles;
};

async function autoAddToMemberChats(userDid: string, circleId: string) {
    // Find the “members” chat in that circle
    const membersChat = await getChatRoomByHandle(circleId, "members");
    if (!membersChat?._id) return;

    // Add the user to the DB membership for that chat
    await addChatRoomMember(userDid, membersChat._id);
}

async function autoRemoveFromMemberChats(userDid: string, circleId: string) {
    const membersChat = await getChatRoomByHandle(circleId, "members");
    if (!membersChat?._id) return;

    // Remove from DB membership
    await removeChatRoomMember(userDid, membersChat._id);
}

/**
 * Get the user IDs (_id from circles collection) of members belonging to a specific user group within a circle.
 * @param circleId The ID of the circle
 * @param userGroupHandle The handle of the user group (e.g., "moderators")
 * @returns Array of user IDs (strings)
 */
export const getMemberIdsByUserGroup = async (circleId: string, userGroupHandle: string): Promise<string[]> => {
    try {
        const members = await Members.aggregate([
            // 1. Match members of the specific circle and user group
            {
                $match: {
                    circleId: circleId,
                    userGroups: userGroupHandle,
                },
            },
            // 2. Lookup the user's details from the 'circles' collection using userDid
            {
                $lookup: {
                    from: "circles",
                    localField: "userDid",
                    foreignField: "did",
                    pipeline: [
                        // Ensure we only get user documents
                        { $match: { circleType: "user" } },
                        // Project only the _id
                        { $project: { _id: 1 } },
                    ],
                    as: "userDetails",
                },
            },
            // 3. Unwind the userDetails array (should usually be one)
            { $unwind: { path: "$userDetails", preserveNullAndEmptyArrays: false } },
            // 4. Project just the user's _id as a string
            {
                $project: {
                    _id: 0, // Exclude the member _id
                    userId: { $toString: "$userDetails._id" },
                },
            },
        ]).toArray();

        // Extract the user IDs into a simple array
        return members.map((m) => m.userId);
    } catch (error) {
        console.error(`Error getting member IDs for group ${userGroupHandle} in circle ${circleId}:`, error);
        throw error; // Re-throw error to be handled by the caller
    }
};
