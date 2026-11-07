"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { Circles } from "@/lib/data/db";
import { getMember } from "@/lib/data/member";
import { removeTeamNote, setTeamCardVisibility, setTeamNote } from "@/lib/data/team-card";
import { teamCardRoleOf, validateTeamNote } from "@/lib/peerify/team-card";

type TeamCardActionResult = { success: boolean; message?: string };

// The circle (not a personal profile) and the signed-in viewer's role in it.
const loadContext = async (circleId: string) => {
    const userDid = await getAuthenticatedUserDid();
    if (!userDid) return { error: "You need to be logged in." } as const;
    if (!ObjectId.isValid(circleId)) return { error: "Circle not found." } as const;
    const circle = await Circles.findOne({ _id: new ObjectId(circleId) }, { projection: { handle: 1, circleType: 1 } });
    if (!circle || circle.circleType === "user") return { error: "Circle not found." } as const;
    const member = await getMember(userDid, circleId);
    return { userDid, handle: circle.handle as string | undefined, role: teamCardRoleOf(member?.userGroups) } as const;
};

const refresh = (handle: string | undefined) => {
    if (handle) revalidatePath(`/circles/${handle}`);
};

/** An admin or moderator shows or hides themself on the Team card. Their own row only. */
export const setTeamCardVisibilityAction = async (
    circleId: string,
    visible: boolean,
): Promise<TeamCardActionResult> => {
    const context = await loadContext(circleId);
    if ("error" in context) return { success: false, message: context.error };
    if (!context.role) return { success: false, message: "Only this circle's admins and moderators can be on the Team card." };
    await setTeamCardVisibility(context.userDid, circleId, visible === true);
    refresh(context.handle);
    return { success: true };
};

/** An admin posts the Team note; it replaces the old one. Moderators and others can't. */
export const saveTeamNoteAction = async (circleId: string, text: string): Promise<TeamCardActionResult> => {
    const context = await loadContext(circleId);
    if ("error" in context) return { success: false, message: context.error };
    if (context.role !== "Admin") return { success: false, message: "Only this circle's admins can post the team note." };
    const checked = validateTeamNote(text);
    if ("error" in checked) return { success: false, message: checked.error };
    await setTeamNote(circleId, context.userDid, checked.text);
    refresh(context.handle);
    return { success: true };
};

/** An admin removes the Team note. */
export const removeTeamNoteAction = async (circleId: string): Promise<TeamCardActionResult> => {
    const context = await loadContext(circleId);
    if ("error" in context) return { success: false, message: context.error };
    if (context.role !== "Admin") return { success: false, message: "Only this circle's admins can remove the team note." };
    await removeTeamNote(circleId);
    refresh(context.handle);
    return { success: true };
};
